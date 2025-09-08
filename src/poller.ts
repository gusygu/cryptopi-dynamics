// Unified poller: Ingest once -> DB (raw + normalized) -> (optional) trade -> CIN build
import { db } from '@/core/db';
import { saveBalancesRaw, upsertWalletSnapshotFromPayload } from '@/sources/ingest/saver';
import { buildCinAuxForCycle, persistCinAux } from '@/auxiliary/cin-aux/buildCinAux';
import { compileRoutes } from '@/auxiliary/cin-aux/flow/compiler';
import { runRoutes } from '@/auxiliary/cin-aux/flow/coordinator';

export type PricesRow = { symbol: string; price_usdt: number };
export type MeaRow = { base: string; quote: string; metric?: string; value: number };

// Adapter you plug with your real Binance client
export interface IngestProvider {
  fetchBalances(): Promise<{ balances: Array<{ asset: string; free?: number|string; locked?: number|string; qty?: number }> }>;
  fetchPricesUSDT(): Promise<PricesRow[]>;
  // optional: if MEA emits pair-level orientations here, we’ll persist them
  fetchMeaOrientations?(): Promise<MeaRow[]>;
}

async function upsertPrices(cycleTs: number, prices: PricesRow[]) {
  if (!prices?.length) return;
  const values: any[] = [];
  const tuples = prices.map((p, i) => {
    const j = i * 3;
    values.push(cycleTs, p.symbol, Number(p.price_usdt));
    return `($${j+1},$${j+2},$${j+3})`;
  }).join(',');
  await db.query(
    `insert into prices_usdt(cycle_ts, symbol, price_usdt)
     values ${tuples}
     on conflict (cycle_ts,symbol) do update set price_usdt = excluded.price_usdt`,
    values
  );
}

async function writeMea(cycleTs: number, rows?: MeaRow[]) {
  if (!rows?.length) return;
  const values: any[] = [];
  const tuples = rows.map((r, i) => {
    const j = i * 5;
    values.push(cycleTs, r.base, r.quote, r.metric ?? 'id_pct', Number(r.value));
    return `($${j+1},$${j+2},$${j+3},$${j+4},$${j+5})`;
  }).join(',');
  await db.query(
    `insert into mea_orientations(cycle_ts, base, quote, metric, value)
     values ${tuples}
     on conflict do nothing`,
    values
  );
}

type Options = {
  appSessionId?: string;
  intervalMs?: number;      // default 40000
  runCoordinator?: boolean; // run compiler+coordinator each tick (default false)
  provider: IngestProvider;
};

let ticking = false;
let timer: NodeJS.Timeout | null = null;

export function startUnifiedPoller(opts: Options) {
  const {
    appSessionId = 'dev-session',
    intervalMs = Number(process.env.POLL_MS ?? 40000),
    runCoordinator = String(process.env.RUN_COORDINATOR || 'false').toLowerCase() === 'true',
    provider,
  } = opts;

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const cycleTs = Date.now();
      await db.query(`insert into app_sessions(app_session_id) values ($1) on conflict do nothing`, [appSessionId]);
      await db.query(`insert into cycles(cycle_ts) values ($1) on conflict do nothing`, [cycleTs]);

      // 1) INGEST (raw + normalized)
      const balancesPayload = await provider.fetchBalances();
      await saveBalancesRaw(db, appSessionId, Date.now(), balancesPayload);
      await upsertWalletSnapshotFromPayload(db, appSessionId, cycleTs, balancesPayload);

      const prices = await provider.fetchPricesUSDT();
      await upsertPrices(cycleTs, prices);

      const mea = provider.fetchMeaOrientations ? await provider.fetchMeaOrientations() : undefined;
      await writeMea(cycleTs, mea);

      // 2) (optional) TRADE: compile -> coordinate (writes ledger)
      if (runCoordinator) {
        const intents = await compileRoutes(db, appSessionId, cycleTs);
        await runRoutes(db, intents);
      }

      // 3) CIN BUILD (reads wallets, prices, mea_unified_refs, and ledger)
      const rows = await buildCinAuxForCycle(db, appSessionId, cycleTs);
      await persistCinAux(db, rows);

      // eslint-disable-next-line no-console
      console.log(`[poller] cycle ${cycleTs} done: cin rows ${rows.length}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[poller] tick error:', e);
    } finally {
      ticking = false;
    }
  }

  // first tick immediately, then interval
  tick();
  timer = setInterval(tick, intervalMs);

  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}
// ...existing imports and code above...

/** Run a single ingest → (optional trade) → CIN build cycle (no interval). */
export async function runUnifiedOnce(opts: {
  appSessionId?: string;
  provider: IngestProvider;
  runCoordinator?: boolean;
  cycleTs?: number; // optional override (epoch ms)
}): Promise<{ appSessionId: string; cycleTs: number; cinRows: number }> {
  const appSessionId = opts.appSessionId ?? 'dev-session';
  const cycleTs = Number.isFinite(opts.cycleTs) && opts.cycleTs! > 0 ? Number(opts.cycleTs) : Date.now();
  const runCoordinator = !!opts.runCoordinator;
  const provider = opts.provider;

  await db.query(`insert into app_sessions(app_session_id) values ($1) on conflict do nothing`, [appSessionId]);
  await db.query(`insert into cycles(cycle_ts) values ($1) on conflict do nothing`, [cycleTs]);

  // 1) Ingest
  const balancesPayload = await provider.fetchBalances();
  await saveBalancesRaw(db, appSessionId, Date.now(), balancesPayload);
  await upsertWalletSnapshotFromPayload(db, appSessionId, cycleTs, balancesPayload);

  const prices = await provider.fetchPricesUSDT();
  await upsertPrices(cycleTs, prices);

  const mea = provider.fetchMeaOrientations ? await provider.fetchMeaOrientations() : undefined;
  await writeMea(cycleTs, mea);

  // 2) Optional trade
  if (runCoordinator) {
    const intents = await compileRoutes(db, appSessionId, cycleTs);
    await runRoutes(db, intents);
  }

  // 3) CIN build
  const rows = await buildCinAuxForCycle(db, appSessionId, cycleTs);
  await persistCinAux(db, rows);

  return { appSessionId, cycleTs, cinRows: rows.length };
}
