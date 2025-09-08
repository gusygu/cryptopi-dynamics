// src/lib/str-aux/sessionDb.ts
// -----------------------------------------------------------------------------
// Matches the columns created in src/db/ddl-str.sql (see above).
// Provides both a named export (sessionDb) and a default export.
// -----------------------------------------------------------------------------

import { Pool } from 'pg';
import type { SymbolSession } from '@/str-aux/session';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
});

export type Key = {
  base: string;
  quote: string;
  window: '30m' | '1h' | '3h';
  appSessionId: string;
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
 * openingStamp is OR'ed (sticky) once true.
 * shiftStamp reflects the latest decision (true only on that cycle).
 */
export async function upsertSession(
  key: Key,
  ss: SymbolSession,
  openingStamp: boolean,
  shiftStamp: boolean,
  gfmDelta?: number
) {
  const { gfmr, gfmCalc, gfmR, uiEpoch } = pickSessionFields(ss);

  const q = `
    INSERT INTO strategy_aux.str_aux_session
      (pair_base, pair_quote, window_key, app_session_id,
       opening_stamp, shift_stamp,
       opening_ts, opening_price,
       price_min, price_max, bench_pct_min, bench_pct_max,
       swaps, shifts,
       gfm_anchor_price, gfm_calc_price_last, gfm_r_last,
       ui_epoch,
       above_count, below_count,
       eta_pct, eps_shift_pct, k_cycles,
       last_price, last_update_ms, snap_prev, snap_cur,
       greatest_bench_abs, greatest_drv_abs, greatest_pct24h_abs,
       gfm_delta_last)
    VALUES
      ($1,$2,$3,$4,
       $5,$6,
       $7,$8,
       $9,$10,$11,$12,
       $13,$14,
       $15,$16,$17,
       $18,
       $19,$20,
       $21,$22,$23,
       $24,$25,$26,$27,
       $28,$29,$30,
       $31)
    ON CONFLICT (pair_base, pair_quote, window_key, app_session_id)
    DO UPDATE SET
      opening_stamp        = strategy_aux.str_aux_session.opening_stamp OR EXCLUDED.opening_stamp,
      shift_stamp          = EXCLUDED.shift_stamp,
      price_min            = LEAST(strategy_aux.str_aux_session.price_min, EXCLUDED.price_min),
      price_max            = GREATEST(strategy_aux.str_aux_session.price_max, EXCLUDED.price_max),
      bench_pct_min        = LEAST(strategy_aux.str_aux_session.bench_pct_min, EXCLUDED.bench_pct_min),
      bench_pct_max        = GREATEST(strategy_aux.str_aux_session.bench_pct_max, EXCLUDED.bench_pct_max),
      swaps                = EXCLUDED.swaps,
      shifts               = EXCLUDED.shifts,
      gfm_anchor_price     = EXCLUDED.gfm_anchor_price,
      gfm_calc_price_last  = EXCLUDED.gfm_calc_price_last,
      gfm_r_last           = EXCLUDED.gfm_r_last,
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
      greatest_bench_abs   = GREATEST(strategy_aux.str_aux_session.greatest_bench_abs, EXCLUDED.greatest_bench_abs),
      greatest_drv_abs     = GREATEST(strategy_aux.str_aux_session.greatest_drv_abs, EXCLUDED.greatest_drv_abs),
      greatest_pct24h_abs  = GREATEST(strategy_aux.str_aux_session.greatest_pct24h_abs, EXCLUDED.greatest_pct24h_abs),
      gfm_delta_last       = EXCLUDED.gfm_delta_last
    RETURNING id
  `;

  const values = [
    key.base,
    key.quote,
    key.window,
    key.appSessionId,

    openingStamp,
    shiftStamp,

    ss.openingTs,
    ss.openingPrice,

    ss.priceMin,
    ss.priceMax,
    ss.benchPctMin,
    ss.benchPctMax,

    ss.swaps,
    ss.shifts,

    gfmr,           // gfm_anchor_price (GFMr)
    gfmCalc,        // gfm_calc_price_last (GFMc)
    gfmR,           // gfm_r_last (last emitted GFMr if you mirror it)

    uiEpoch,        // ui_epoch

    ss.aboveCount ?? 0,
    ss.belowCount ?? 0,

    ss.etaPct,
    ss.epsShiftPct,
    ss.K,

    ss.lastPrice ?? null,
    Date.now(),
    JSON.stringify((ss as any).snapPrev ?? null),
    JSON.stringify((ss as any).snapCur ?? null),

    ss.greatestBenchAbs,
    ss.greatestDrvAbs,
    ss.greatestPct24hAbs ?? 0,

    gfmDelta ?? ss.gfmDeltaAbsPct ?? 0,
  ];

  const r = await pool.query(q, values);
  return r.rows[0]?.id as number;
}

export async function insertEvent(
  sessionId: number,
  kind: 'opening' | 'shift' | 'swap',
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

export const sessionDb = {
  upsertSession,
  insertEvent,
};

export default sessionDb;
