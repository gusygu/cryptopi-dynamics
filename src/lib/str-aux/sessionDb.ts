// src/lib/str-aux/sessionDb.ts
// -----------------------------------------------------------------------------
// Persists Strategy-Aux session state and emits structured events.
// Compatible with src/db/ddl-str.sql (updated with shift/swap quick-stamps).
// -----------------------------------------------------------------------------

import { Pool } from "pg";
import type { SymbolSession } from "@/str-aux/session";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
});

export type Key = {
  base: string;
  quote: string;
  window: "30m" | "1h" | "3h";
  appSessionId: string;
};

export type UpsertExtras = {
  // overlay stamps (hh:mm:ss) + structured counters/sign
  shift_hms?: string | null;
  swap_hms?: string | null;
  swap_sign?: "ascending" | "descending" | null;
  shift_n?: number | null;
  swap_n?: number | null;

  // deterministic tests
  nowMs?: number;
};

function pickSessionFields(ss: any) {
  const gfmr =
    ss.gfmRefPrice ??
    ss.gfmAnchorPrice ??
    null;

  const gfmCalc =
    ss.gfmCalcPrice ??
    ss.gfm_calc_price ??
    null;

  const gfmR =
    ss.gfmRLast ??
    ss.gfm_r_last ??
    ss.gfm_r ??
    null;

  const uiEpoch = ss.uiEpoch ?? 0;

  return { gfmr, gfmCalc, gfmR, uiEpoch };
}

/**
 * Upsert current session state for (base, quote, window, app_session).
 * - openingStamp is "sticky" (OR-ed once true).
 * - shiftStamp reflects the latest decision this cycle (boolean).
 * - gfmDeltaAbs is the absolute |GFMΔ%| vs GFMr for quick filtering.
 * - extras carries hh:mm:ss stamps and swap sign/counters for structured event logging.
 *
 * Emits events:
 *  - 'opening' when openingStamp true on this tick
 *  - 'shift'   when shiftStamp=true OR shifts counter increased
 *  - 'swap'    when swaps counter increased
 */
export async function upsertSession(
  key: Key,
  ss: SymbolSession,
  openingStamp: boolean,
  shiftStamp: boolean,
  gfmDeltaAbs: number,
  extras: UpsertExtras = {}
): Promise<number> {
  const client = await pool.connect();
  const { gfmr, gfmCalc, gfmR, uiEpoch } = pickSessionFields(ss);
  const now = extras.nowMs ?? Date.now();

  // 1) Look up previous counters to detect new events this tick
  const selectSql = `
    SELECT id, swaps, shifts
    FROM strategy_aux.str_aux_session
    WHERE pair_base=$1 AND pair_quote=$2 AND window_key=$3 AND app_session_id=$4
    LIMIT 1
  `;
  const selectArgs = [key.base, key.quote, key.window, key.appSessionId];

  // 2) Upsert current snapshot
  const upsertSql = `
    INSERT INTO strategy_aux.str_aux_session (
      pair_base, pair_quote, window_key, app_session_id,

      opening_stamp, opening_ts, opening_price,

      price_min, price_max, bench_pct_min, bench_pct_max,

      swaps, shifts,

      gfm_anchor_price, gfm_calc_price_last, gfm_r_last,

      ui_epoch, above_count, below_count,

      eta_pct, eps_shift_pct, k_cycles,

      last_price, last_update_ms,

      snap_prev, snap_cur,

      greatest_bench_abs, greatest_drv_abs, greatest_pct24h_abs,

      shift_stamp, gfm_delta_last,

      -- quick-stamps (NEW)
      shift_last_hms, swap_last_hms, swap_last_sign
    )
    VALUES (
      $1,$2,$3,$4,

      $5,$6,$7,

      $8,$9,$10,$11,

      $12,$13,

      $14,$15,$16,

      $17,$18,$19,

      $20,$21,$22,

      $23,$24,

      $25,$26,

      $27,$28,$29,

      $30,$31,

      $32,$33,$34
    )
    ON CONFLICT (pair_base, pair_quote, window_key, app_session_id)
    DO UPDATE SET
      opening_stamp        = strategy_aux.str_aux_session.opening_stamp OR EXCLUDED.opening_stamp,
      opening_ts           = LEAST(strategy_aux.str_aux_session.opening_ts, EXCLUDED.opening_ts),
      opening_price        = strategy_aux.str_aux_session.opening_price,

      price_min            = LEAST(strategy_aux.str_aux_session.price_min, EXCLUDED.price_min),
      price_max            = GREATEST(strategy_aux.str_aux_session.price_max, EXCLUDED.price_max),
      bench_pct_min        = LEAST(strategy_aux.str_aux_session.bench_pct_min, EXCLUDED.bench_pct_min),
      bench_pct_max        = GREATEST(strategy_aux.str_aux_session.bench_pct_max, EXCLUDED.bench_pct_max),

      swaps                = EXCLUDED.swaps,
      shifts               = EXCLUDED.shifts,

      gfm_anchor_price     = COALESCE(EXCLUDED.gfm_anchor_price, strategy_aux.str_aux_session.gfm_anchor_price),
      gfm_calc_price_last  = EXCLUDED.gfm_calc_price_last,
      gfm_r_last           = COALESCE(EXCLUDED.gfm_r_last, strategy_aux.str_aux_session.gfm_r_last),

      ui_epoch             = EXCLUDED.ui_epoch,
      above_count          = EXCLUDED.above_count,
      below_count          = EXCLUDED.below_count,

      eta_pct              = EXCLUDED.eta_pct,
      eps_shift_pct        = EXCLUDED.eps_shift_pct,
      k_cycles             = EXCLUDED.k_cycles,

      last_price           = EXCLUDED.last_price,
      last_update_ms       = EXCLUDED.last_update_ms,

      snap_prev            = EXCLUDED.snap_prev,
      snap_cur             = EXCLUDED.snap_cur,

      greatest_bench_abs   = GREATEST(strategy_aux.str_aux_session.greatest_bench_abs,  EXCLUDED.greatest_bench_abs),
      greatest_drv_abs     = GREATEST(strategy_aux.str_aux_session.greatest_drv_abs,    EXCLUDED.greatest_drv_abs),
      greatest_pct24h_abs  = GREATEST(strategy_aux.str_aux_session.greatest_pct24h_abs, EXCLUDED.greatest_pct24h_abs),

      shift_stamp          = EXCLUDED.shift_stamp,
      gfm_delta_last       = EXCLUDED.gfm_delta_last,

      shift_last_hms       = COALESCE(EXCLUDED.shift_last_hms, strategy_aux.str_aux_session.shift_last_hms),
      swap_last_hms        = COALESCE(EXCLUDED.swap_last_hms,  strategy_aux.str_aux_session.swap_last_hms),
      swap_last_sign       = COALESCE(EXCLUDED.swap_last_sign, strategy_aux.str_aux_session.swap_last_sign)
    RETURNING id
  `;

  const upsertArgs = [
    key.base, key.quote, key.window, key.appSessionId,

    !!openingStamp, ss.openingTs, ss.openingPrice,

    ss.priceMin, ss.priceMax, ss.benchPctMin, ss.benchPctMax,

    ss.swaps, ss.shifts,

    gfmr,                // gfm_anchor_price (GFMr)
    gfmCalc,             // gfm_calc_price_last (GFMc)
    gfmR,                // gfm_r_last

    uiEpoch,
    ss.aboveCount ?? 0,
    ss.belowCount ?? 0,

    ss.etaPct,           // swap epsilon (%)
    ss.epsShiftPct,      // shift epsilon (%)
    ss.K,                // K-cycles

    ss.lastPrice ?? ss.openingPrice,
    now,

    JSON.stringify((ss as any).snapPrev ?? null),
    JSON.stringify((ss as any).snapCur ?? null),

    ss.greatestBenchAbs,
    ss.greatestDrvAbs,
    ss.greatestPct24hAbs ?? 0,

    !!shiftStamp,
    gfmDeltaAbs,

    // quick stamps (NEW)
    extras.shift_hms ?? null,
    extras.swap_hms ?? null,
    extras.swap_sign ?? null,
  ];

  try {
    await client.query("BEGIN");

    const prevRes = await client.query<{ id: number; swaps: number; shifts: number }>(
      selectSql,
      selectArgs
    );
    const prev = prevRes.rows[0]; // undefined if new row

    const upRes = await client.query<{ id: number }>(upsertSql, upsertArgs);
    const sessionId = upRes.rows[0]?.id as number;

    // Decide which events to emit
    const newOpening = !!openingStamp;
    const newShift   = !!shiftStamp || (prev ? ss.shifts > (prev.shifts ?? 0) : false);
    const newSwap    = prev ? ss.swaps > (prev.swaps ?? 0) : false;

    // (1) opening event
    if (newOpening) {
      await client.query(
        `INSERT INTO strategy_aux.str_aux_event
           (session_id, kind, payload, created_ms)
         VALUES ($1,'opening',$2,$3)`,
        [
          sessionId,
          JSON.stringify({ opening_ts: ss.openingTs, opening_price: ss.openingPrice }),
          now,
        ]
      );
    }

    // (2) shift event (structured fields + payload)
    if (newShift) {
      await client.query(
        `INSERT INTO strategy_aux.str_aux_event
           (session_id, kind, payload, created_ms, shift_n, shift_hms)
         VALUES ($1,'shift',$2,$3,$4,$5)`,
        [
          sessionId,
          JSON.stringify({
            ui_epoch: ss.uiEpoch,
            gfm_ref_price: gfmr,
            gfm_calc_price: gfmCalc,
            gfm_delta_abs_pct: gfmDeltaAbs,
          }),
          now,
          (extras.shift_n ?? ss.shifts) ?? null,
          extras.shift_hms ?? null,
        ]
      );
    }

    // (3) swap event (structured fields + payload)
    if (newSwap) {
      await client.query(
        `INSERT INTO strategy_aux.str_aux_event
           (session_id, kind, payload, created_ms, swap_n, swap_sign, swap_hms)
         VALUES ($1,'swap',$2,$3,$4,$5,$6)`,
        [
          sessionId,
          JSON.stringify({
            bench_pct_sign: signOf(ss.lastBenchSign),
          }),
          now,
          (extras.swap_n ?? ss.swaps) ?? null,
          extras.swap_sign ?? null,
          extras.swap_hms ?? null,
        ]
      );
    }

    await client.query("COMMIT");
    return sessionId;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// Optional direct event adder (kept for parity with your previous file)
export async function insertEvent(
  sessionId: number,
  kind: "opening" | "shift" | "swap",
  payload: any,
  createdMs: number
) {
  const q = `
    INSERT INTO strategy_aux.str_aux_event
      (session_id, kind, payload, created_ms)
    VALUES ($1, $2, $3, $4)
  `;
  await pool.query(q, [sessionId, kind, payload, createdMs]);
}

function signOf(s: number): "positive" | "negative" | "zero" {
  if (s > 0) return "positive";
  if (s < 0) return "negative";
  return "zero";
}

export const sessionDb = {
  upsertSession,
  insertEvent,
};

export default sessionDb;
