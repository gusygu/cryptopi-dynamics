import { Pool } from 'pg';

export type CinAuxRow = {
  appSessionId: string;
  cycleTs: number;
  symbol: string;
  walletUsdt: number;
  profitUsdt: number;           // now prefers ledger realized
  imprintCycleUsdt: number;     // from residual inflow - outflow
  luggageCycleUsdt: number;     // realized - expected
};

type PriceMap = Record<string, number>;
type QtyMap   = Record<string, number>;
type IdPctMap = Record<string, number>;

export async function buildCinAuxForCycle(db: Pool, appSessionId: string, cycleTs: number): Promise<CinAuxRow[]> {
  // prev cycle
  const { rows: prevRow } = await db.query<{ prev_ts: number }>(
    `select max(cycle_ts) as prev_ts
       from wallet_snapshots
      where app_session_id = $1 and cycle_ts < $2`,
    [appSessionId, cycleTs]
  );
  const prevTs = prevRow[0]?.prev_ts ?? null;

  // prices (USDT) at T
  const priceRows = await db.query<{ symbol: string; price_usdt: number }>(
    `select symbol, price_usdt from prices_usdt where cycle_ts = $1`,
    [cycleTs]
  );
  const priceMap: PriceMap = Object.fromEntries(priceRows.rows.map(r => [r.symbol, r.price_usdt]));

  // MEA id_pct at T
  const idPctRows = await db.query<{ symbol: string; id_pct: number }>(
    `select symbol, id_pct from mea_unified_refs where cycle_ts = $1`,
    [cycleTs]
  );
  const idPctMap: IdPctMap = Object.fromEntries(idPctRows.rows.map(r => [r.symbol, r.id_pct || 0]));

  // wallets at T and T-1
  const curRows = await db.query<{ symbol: string; qty: number }>(
    `select symbol, qty from wallet_snapshots where app_session_id = $1 and cycle_ts = $2`,
    [appSessionId, cycleTs]
  );
  const prevRows = prevTs
    ? await db.query<{ symbol: string; qty: number }>(
        `select symbol, qty from wallet_snapshots where app_session_id = $1 and cycle_ts = $2`,
        [appSessionId, prevTs]
      )
    : { rows: [] as { symbol: string; qty: number }[] };

  const curQty: QtyMap  = Object.fromEntries(curRows.rows.map(r => [r.symbol, r.qty]));
  const prevQty: QtyMap = Object.fromEntries(prevRows.rows.map(r => [r.symbol, r.qty]));

  // ledger rollup (if any)
  const roll = await db.query<{
    symbol: string;
    inflow_usdt: number;
    outflow_usdt: number;
    realized_profit_usdt: number;
    fees_usdt: number;
  }>(
    `select symbol, inflow_usdt, outflow_usdt, realized_profit_usdt, fees_usdt
       from v_transfer_ledger_rollup
      where app_session_id = $1 and cycle_ts = $2`,
    [appSessionId, cycleTs]
  );
  const ledger = new Map(roll.rows.map(r => [r.symbol, r]));

  // symbols union
  const symbols = new Set<string>([
    ...Object.keys(curQty),
    ...Object.keys(prevQty),
    ...Object.keys(priceMap),
    ...Object.keys(idPctMap),
    ...roll.rows.map(r => r.symbol),
  ]);

  const out: CinAuxRow[] = [];

  for (const symbol of symbols) {
    const price = priceMap[symbol] ?? 0;
    const curQ = curQty[symbol] ?? 0;
    const prevQ = prevQty[symbol] ?? 0;

    const walletUsdt = curQ * price;
    const deltaWalletUsdt = (curQ - prevQ) * price;

    const idPct = idPctMap[symbol] ?? 0;
    const expectedProfitUsdt = deltaWalletUsdt * idPct;

    const leg = ledger.get(symbol);
    const realized = leg?.realized_profit_usdt ?? null;

    // Residual flow to detect imprint on intermediates
    const inflowUsdt  = leg?.inflow_usdt  ?? 0;
    const outflowUsdt = leg?.outflow_usdt ?? 0;
    const residualUsdt = inflowUsdt - outflowUsdt;

    const profitUsdt = realized ?? expectedProfitUsdt; // prefer ledger if available
    const imprintCycleUsdt = Math.max(0, residualUsdt);
    const luggageCycleUsdt = profitUsdt - expectedProfitUsdt;

    out.push({
      appSessionId,
      cycleTs,
      symbol,
      walletUsdt,
      profitUsdt,
      imprintCycleUsdt,
      luggageCycleUsdt,
    });
  }

  return out;
}

export async function persistCinAux(db: Pool, rows: CinAuxRow[]) {
  if (!rows.length) return;

  const text =
    `insert into cin_aux_cycle
      (app_session_id, cycle_ts, symbol, wallet_usdt, profit_usdt, imprint_cycle_usdt, luggage_cycle_usdt)
     values ` +
    rows.map((_, i) =>
      `($${i * 7 + 1}, $${i * 7 + 2}, $${i * 7 + 3}, $${i * 7 + 4}, $${i * 7 + 5}, $${i * 7 + 6}, $${i * 7 + 7})`,
    ).join(',') +
    ` on conflict (app_session_id, cycle_ts, symbol)
        do update set
          wallet_usdt = excluded.wallet_usdt,
          profit_usdt = excluded.profit_usdt,
          imprint_cycle_usdt = excluded.imprint_cycle_usdt,
          luggage_cycle_usdt = excluded.luggage_cycle_usdt`;

  const values = rows.flatMap(r => [
    r.appSessionId, r.cycleTs, r.symbol,
    r.walletUsdt, r.profitUsdt, r.imprintCycleUsdt, r.luggageCycleUsdt,
  ]);
  await db.query(text, values);

  const accText =
    `insert into cin_aux_session_acc (app_session_id, symbol, imprint_acc_usdt, luggage_acc_usdt)
     values ` +
    rows.map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`).join(',') +
    ` on conflict (app_session_id, symbol)
        do update set
          imprint_acc_usdt = cin_aux_session_acc.imprint_acc_usdt + excluded.imprint_acc_usdt,
          luggage_acc_usdt = cin_aux_session_acc.luggage_acc_usdt + excluded.luggage_acc_usdt`;

  const accValues = rows.flatMap(r => [r.appSessionId, r.symbol, r.imprintCycleUsdt, r.luggageCycleUsdt]);
  await db.query(accText, accValues);
}
