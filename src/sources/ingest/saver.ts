import type { Pool } from 'pg';

export type BalanceRaw = { asset: string; free?: string|number; locked?: string|number; qty?: number };
export type SnapshotPayload = { balances: BalanceRaw[]; [k: string]: any };

export async function saveBalancesRaw(
  db: Pool,
  appSessionId: string,
  fetchedAtMs: number,
  payload: SnapshotPayload
) {
  await db.query(
    `insert into binance_balances_raw(app_session_id, fetched_at_ms, payload)
     values ($1,$2,$3)
     on conflict (app_session_id, fetched_at_ms) do update set payload=excluded.payload`,
    [appSessionId, fetchedAtMs, payload]
  );
}

/** optional: write normalized wallet snapshot for a given cycle directly */
export async function upsertWalletSnapshotFromPayload(
  db: Pool,
  appSessionId: string,
  cycleTs: number,
  payload: SnapshotPayload
) {
  const balances = Array.isArray(payload?.balances) ? payload.balances : [];
  for (const b of balances) {
    const symbol = String(b.asset);
    const qty = (b.qty != null)
      ? Number(b.qty)
      : Number(b.free || 0) + Number(b.locked || 0);
    if (!Number.isFinite(qty)) continue;

    await db.query(
      `insert into wallet_snapshots(app_session_id, cycle_ts, symbol, qty)
       values ($1,$2,$3,$4)
       on conflict (app_session_id, cycle_ts, symbol) do update set qty=excluded.qty`,
      [appSessionId, cycleTs, symbol, qty]
    );
  }
}

/** optional: save trades raw (you can shape payload as you like) */
export async function saveTradesRaw(
  db: Pool,
  appSessionId: string,
  fetchedAtMs: number,
  payload: any
) {
  await db.query(
    `insert into binance_trades_raw(app_session_id, fetched_at_ms, payload)
     values ($1,$2,$3)
     on conflict (app_session_id, fetched_at_ms) do update set payload=excluded.payload`,
    [appSessionId, fetchedAtMs, payload]
  );
}
