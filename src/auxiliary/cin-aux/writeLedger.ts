import { Pool } from 'pg';

export type LedgerEntry = {
  appSessionId: string;
  cycleTs: number;
  legSeq: number;           // 1..n per cycle
  fromSymbol: string;
  toSymbol: string;
  qtyFrom: number;
  qtyTo: number;
  priceFromUsdt: number;
  priceToUsdt: number;
  feeUsdt?: number;
  execTs: number;           // epoch ms
  routeId?: string;
  intentId?: string;
  txId?: string | null;
};

export async function insertLedgerEntries(db: Pool, entries: LedgerEntry[]) {
  if (!entries.length) return;

  const text =
    `insert into transfer_ledger
      (app_session_id, cycle_ts, leg_seq, route_id, intent_id,
       from_symbol, to_symbol, qty_from, qty_to,
       price_from_usdt, price_to_usdt, fee_usdt, exec_ts, tx_id)
     values ` +
    entries.map((_, i) => {
      const base = i * 14;
      return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5},
               $${base+6}, $${base+7}, $${base+8}, $${base+9},
               $${base+10}, $${base+11}, $${base+12}, $${base+13}, $${base+14})`;
    }).join(',') +
    ` on conflict (app_session_id, cycle_ts, leg_seq)
        do update set
          qty_from = excluded.qty_from,
          qty_to = excluded.qty_to,
          price_from_usdt = excluded.price_from_usdt,
          price_to_usdt = excluded.price_to_usdt,
          fee_usdt = excluded.fee_usdt,
          exec_ts = excluded.exec_ts,
          route_id = excluded.route_id,
          intent_id = excluded.intent_id,
          tx_id = excluded.tx_id`;

  const values = entries.flatMap(e => [
    e.appSessionId, e.cycleTs, e.legSeq, e.routeId || null, e.intentId || null,
    e.fromSymbol, e.toSymbol, e.qtyFrom, e.qtyTo,
    e.priceFromUsdt, e.priceToUsdt, e.feeUsdt ?? 0, e.execTs, e.txId || null,
  ]);

  await db.query(text, values);
}
