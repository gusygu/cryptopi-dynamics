import 'dotenv/config';
import pgPkg from 'pg';
const { Pool } = pgPkg;

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  ssl: String(process.env.PGSSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
});

const appSessionId = process.env.APP_SESSION_ID || 'dev-session';
const cycleTs = Number(process.env.CYCLE_TS || Date.now()); // epoch ms

const pricesFromEnv = (() => { try { return process.env.PRICES_JSON ? JSON.parse(process.env.PRICES_JSON) : null; } catch { return null; } })();
const meaFromEnv    = (() => { try { return process.env.MEA_JSON ? JSON.parse(process.env.MEA_JSON) : null; } catch { return null; } })();
const walletFromEnv = (() => { try { return process.env.WALLET_JSON ? JSON.parse(process.env.WALLET_JSON) : null; } catch { return null; } })();

async function normalizeBalances(sessionId, ts) {
  let balances = null;

  const r = await db.query(
    `select payload from binance_balances_raw
      where app_session_id=$1 order by fetched_at_ms desc limit 1`,
    [sessionId]
  );
  if (r.rows.length) {
    const payload = r.rows[0].payload || {};
    if (Array.isArray(payload.balances)) {
      balances = payload.balances.map(b => ({ asset: String(b.asset), qty: Number(b.free || 0) + Number(b.locked || 0) }));
    }
  }

  if (!balances && Array.isArray(walletFromEnv)) {
    // WALLET_JSON='[{"asset":"BTC","qty":0.2},{"asset":"ETH","qty":3.5},{"asset":"USDT","qty":5000}]'
    balances = walletFromEnv.map(x => ({ asset: String(x.asset), qty: Number(x.qty || 0) }));
  }

  if (!balances) {
    // sample fallback
    balances = [{ asset: 'BTC', qty: 0.2 }, { asset: 'ETH', qty: 3.5 }, { asset: 'USDT', qty: 5000 }];
  }

  for (const b of balances) {
    await db.query(
      `insert into wallet_snapshots(app_session_id, cycle_ts, symbol, qty)
       values ($1,$2,$3,$4)
       on conflict (app_session_id, cycle_ts, symbol)
       do update set qty=excluded.qty`,
      [sessionId, ts, b.asset, b.qty]
    );
  }
  console.log(`[normalize] wrote ${balances.length} wallet rows`);
}

async function normalizePrices(ts) {
  const prices = pricesFromEnv || [
    { symbol: 'BTC',  price_usdt: 60000 },
    { symbol: 'ETH',  price_usdt: 3500  },
    { symbol: 'USDT', price_usdt: 1     },
  ];
  for (const t of prices) {
    await db.query(
      `insert into prices_usdt(cycle_ts, symbol, price_usdt)
       values ($1,$2,$3)
       on conflict (cycle_ts,symbol) do update set price_usdt=excluded.price_usdt`,
      [ts, t.symbol, Number(t.price_usdt)]
    );
  }
  console.log(`[normalize] wrote ${prices.length} prices`);
}

async function writeMea(ts) {
  if (!Array.isArray(meaFromEnv) || !meaFromEnv.length) {
    console.log('[normalize] no MEA_JSON provided; skipping mea_orientations');
    return;
  }
  for (const row of meaFromEnv) {
    await db.query(
      `insert into mea_orientations(cycle_ts, base, quote, metric, value)
       values ($1,$2,$3,$4,$5)
       on conflict do nothing`,
      [ts, row.base, row.quote, row.metric || 'id_pct', Number(row.value)]
    );
  }
  console.log(`[normalize] wrote ${meaFromEnv.length} mea_orientations`);
}

async function main() {
  await db.query(`insert into app_sessions(app_session_id) values ($1) on conflict do nothing`, [appSessionId]);
  for (const c of ['BTC','ETH','USDT']) {
    await db.query(`insert into coins(symbol) values ($1) on conflict do nothing`, [c]);
  }
  await db.query(`insert into cycles(cycle_ts) values ($1) on conflict do nothing`, [cycleTs]);

  await normalizeBalances(appSessionId, cycleTs);
  await normalizePrices(cycleTs);
  await writeMea(cycleTs);

  await db.end();
  console.log('[normalize] done for cycle', cycleTs);
}
main().catch(e => { console.error(e); process.exit(1); });
