-- src/db/ddl-str.sql
-- -------------------------------------------------------------------
-- Strategy Aux schema & tables required by /api/str-aux/bins
-- This script is idempotent (safe to run multiple times).
-- -------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS strategy_aux;

-- ===================================================================
-- Main session row (one row per (base,quote,window,app_session_id))
-- ===================================================================
CREATE TABLE IF NOT EXISTS strategy_aux.str_aux_session (
  id                 BIGSERIAL PRIMARY KEY,

  pair_base          TEXT NOT NULL,
  pair_quote         TEXT NOT NULL DEFAULT 'USDT',
  window_key         TEXT NOT NULL,                 -- '30m' | '1h' | '3h'
  app_session_id     TEXT NOT NULL,

  -- opening anchor for the app session
  opening_stamp      BOOLEAN NOT NULL DEFAULT FALSE,
  opening_ts         BIGINT  NOT NULL,
  opening_price      DOUBLE PRECISION NOT NULL,

  -- running mins/maxs for the session
  price_min          DOUBLE PRECISION NOT NULL,
  price_max          DOUBLE PRECISION NOT NULL,
  bench_pct_min      DOUBLE PRECISION NOT NULL,
  bench_pct_max      DOUBLE PRECISION NOT NULL,

  -- counters
  swaps              INTEGER NOT NULL DEFAULT 0,
  shifts             INTEGER NOT NULL DEFAULT 0,

  -- GFM anchors & helpers
  gfm_anchor_price   DOUBLE PRECISION,              -- GFMr
  gfm_calc_price_last NUMERIC,                      -- last GFMc (optional)
  gfm_r_last         DOUBLE PRECISION,              -- last GFMr emitted (optional)

  ui_epoch           INTEGER NOT NULL DEFAULT 0,
  above_count        INTEGER NOT NULL DEFAULT 0,
  below_count        INTEGER NOT NULL DEFAULT 0,

  -- thresholds
  eta_pct            DOUBLE PRECISION NOT NULL,     -- swap epsilon (percent)
  eps_shift_pct      DOUBLE PRECISION NOT NULL,     -- shift epsilon (percent)
  k_cycles           INTEGER NOT NULL,              -- K=32

  -- last seen
  last_price         DOUBLE PRECISION,
  last_update_ms     BIGINT NOT NULL,

  -- last two snapshots to back the "prev/cur" UI stream
  snap_prev          JSONB,
  snap_cur           JSONB,

  -- greatest absolute magnitudes observed this session
  greatest_bench_abs   DOUBLE PRECISION NOT NULL DEFAULT 0,
  greatest_drv_abs     DOUBLE PRECISION NOT NULL DEFAULT 0,
  greatest_pct24h_abs  DOUBLE PRECISION NOT NULL DEFAULT 0,

  -- shift stamp & last gfm delta
  shift_stamp        BOOLEAN NOT NULL DEFAULT FALSE,
  gfm_delta_last     DOUBLE PRECISION,

  CONSTRAINT uq_str_aux_session UNIQUE (pair_base, pair_quote, window_key, app_session_id)
);

CREATE INDEX IF NOT EXISTS idx_str_aux_session_lookup
  ON strategy_aux.str_aux_session (pair_base, pair_quote, window_key, app_session_id);

-- Backward/forward compatible “ADD COLUMN IF NOT EXISTS” guards
ALTER TABLE strategy_aux.str_aux_session
  ADD COLUMN IF NOT EXISTS gfm_calc_price_last   NUMERIC,
  ADD COLUMN IF NOT EXISTS gfm_r_last            DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS ui_epoch              INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS above_count           INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS below_count           INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS greatest_pct24h_abs   DOUBLE PRECISION DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shift_stamp           BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gfm_delta_last        DOUBLE PRECISION;

-- ===================================================================
-- Event log (opening | swap | shift)
-- ===================================================================
CREATE TABLE IF NOT EXISTS strategy_aux.str_aux_event (
  id           BIGSERIAL PRIMARY KEY,
  session_id   BIGINT NOT NULL REFERENCES strategy_aux.str_aux_session(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,                      -- 'opening' | 'swap' | 'shift'
  payload      JSONB,
  created_ms   BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_str_aux_event_session
  ON strategy_aux.str_aux_event (session_id, created_ms DESC);

-- (Optional) Other tables you may already have (docs/snapshots) are left alone.
