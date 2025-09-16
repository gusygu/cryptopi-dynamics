-- src/db/ddl-str.sql
-- -------------------------------------------------------------------
-- Strategy Aux schema & tables required by /api/str-aux/bins
-- Idempotent & backward-compatible.
-- -------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS strategy_aux;

-- ===================================================================
-- Main session row (one row per (base,quote,window,app_session_id))
-- ===================================================================
CREATE TABLE IF NOT EXISTS strategy_aux.str_aux_session (
  id                   BIGSERIAL PRIMARY KEY,

  pair_base            TEXT NOT NULL,
  pair_quote           TEXT NOT NULL DEFAULT 'USDT',
  window_key           TEXT NOT NULL,                 -- '30m' | '1h' | '3h'
  app_session_id       TEXT NOT NULL,

  -- opening anchor for the app session
  opening_stamp        BOOLEAN NOT NULL DEFAULT FALSE,
  opening_ts           BIGINT  NOT NULL,
  opening_price        DOUBLE PRECISION NOT NULL,

  -- running mins/maxs for the session
  price_min            DOUBLE PRECISION NOT NULL,
  price_max            DOUBLE PRECISION NOT NULL,
  bench_pct_min        DOUBLE PRECISION NOT NULL,
  bench_pct_max        DOUBLE PRECISION NOT NULL,

  -- counters
  swaps                INTEGER NOT NULL DEFAULT 0,
  shifts               INTEGER NOT NULL DEFAULT 0,

  -- GFM anchors & helpers
  gfm_anchor_price     DOUBLE PRECISION,
  gfm_calc_price_last  NUMERIC,
  gfm_r_last           DOUBLE PRECISION,

  ui_epoch             INTEGER NOT NULL DEFAULT 0,
  above_count          INTEGER NOT NULL DEFAULT 0,
  below_count          INTEGER NOT NULL DEFAULT 0,

  -- thresholds
  eta_pct              DOUBLE PRECISION NOT NULL,     -- swap epsilon (percent)
  eps_shift_pct        DOUBLE PRECISION NOT NULL,     -- shift epsilon (percent)
  k_cycles             INTEGER NOT NULL,              -- K=32

  -- last seen
  last_price           DOUBLE PRECISION,
  last_update_ms       BIGINT NOT NULL,

  -- last two snapshots to back the "prev/cur" UI stream
  snap_prev            JSONB,
  snap_cur             JSONB,

  -- greatest absolute magnitudes observed this session
  greatest_bench_abs   DOUBLE PRECISION NOT NULL DEFAULT 0,
  greatest_drv_abs     DOUBLE PRECISION NOT NULL DEFAULT 0,
  greatest_pct24h_abs  DOUBLE PRECISION NOT NULL DEFAULT 0,

  -- shift stamp & last gfm delta
  shift_stamp          BOOLEAN NOT NULL DEFAULT FALSE,
  gfm_delta_last       DOUBLE PRECISION,

  -- NEW: quick stamps for UI (hh:mm:ss) + last swap sign
  shift_last_hms       TEXT,
  swap_last_hms        TEXT,
  swap_last_sign       TEXT,

  CONSTRAINT uq_str_aux_session UNIQUE (pair_base, pair_quote, window_key, app_session_id)
);

ALTER TABLE strategy_aux.str_aux_event
  ADD COLUMN IF NOT EXISTS swap_n     INTEGER,
  ADD COLUMN IF NOT EXISTS swap_sign  TEXT,
  ADD COLUMN IF NOT EXISTS swap_hms   TEXT,
  ADD COLUMN IF NOT EXISTS shift_n    INTEGER,
  ADD COLUMN IF NOT EXISTS shift_hms  TEXT;

CREATE INDEX IF NOT EXISTS idx_str_aux_session_lookup
  ON strategy_aux.str_aux_session (pair_base, pair_quote, window_key, app_session_id);

-- Backward/forward compatible guards (in case table pre-existed without some cols)
ALTER TABLE strategy_aux.str_aux_session
  ADD COLUMN IF NOT EXISTS gfm_calc_price_last   NUMERIC,
  ADD COLUMN IF NOT EXISTS gfm_r_last            DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS ui_epoch              INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS above_count           INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS below_count           INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS greatest_pct24h_abs   DOUBLE PRECISION DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shift_stamp           BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gfm_delta_last        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS shift_last_hms        TEXT,
  ADD COLUMN IF NOT EXISTS swap_last_hms         TEXT,
  ADD COLUMN IF NOT EXISTS swap_last_sign        TEXT;

-- ===================================================================
-- Event log (opening | swap | shift)
-- ===================================================================
CREATE TABLE IF NOT EXISTS strategy_aux.str_aux_event (
  id           BIGSERIAL PRIMARY KEY,
  session_id   BIGINT NOT NULL REFERENCES strategy_aux.str_aux_session(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,                      -- 'opening' | 'swap' | 'shift'
  payload      JSONB,
  created_ms   BIGINT NOT NULL,

  -- NEW: structured fields for fast reads (nullable for 'opening')
  swap_n       INTEGER,
  swap_sign    TEXT,
  swap_hms     TEXT,
  shift_n      INTEGER,
  shift_hms    TEXT
);

CREATE INDEX IF NOT EXISTS idx_str_aux_event_session
  ON strategy_aux.str_aux_event (session_id, created_ms DESC);

CREATE INDEX IF NOT EXISTS idx_str_aux_event_session_kind_time
  ON strategy_aux.str_aux_event (session_id, kind, created_ms DESC);

-- ===================================================================
-- Convenience views (optional)
-- ===================================================================
CREATE OR REPLACE VIEW strategy_aux.v_str_aux_swaps AS
SELECT e.session_id, e.created_ms, e.swap_n, e.swap_sign, e.swap_hms, e.payload
FROM strategy_aux.str_aux_event e
WHERE e.kind = 'swap'
ORDER BY e.session_id, e.created_ms DESC;

CREATE OR REPLACE VIEW strategy_aux.v_str_aux_shifts AS
SELECT e.session_id, e.created_ms, e.shift_n, e.shift_hms, e.payload
FROM strategy_aux.str_aux_event e
WHERE e.kind = 'shift'
ORDER BY e.session_id, e.created_ms DESC;
