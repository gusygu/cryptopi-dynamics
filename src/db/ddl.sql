-- db/ddl.sql
BEGIN;

-- Create a dedicated table for Dynamics matrices (leaves any existing matrix_values table untouched)
CREATE TABLE IF NOT EXISTS dyn_matrix_values (
  ts_ms        BIGINT                     NOT NULL,
  matrix_type  TEXT                       NOT NULL CHECK (matrix_type IN ('benchmark','delta','pct24h','id_pct','pct_drv')),
  base         TEXT                       NOT NULL,
  quote        TEXT                       NOT NULL,
  value        DOUBLE PRECISION           NOT NULL,
  meta         JSONB                      NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (ts_ms, matrix_type, base, quote)
);

-- Fast “latest per pair” lookups
CREATE INDEX IF NOT EXISTS dyn_mv_idx_pair
  ON dyn_matrix_values (matrix_type, base, quote, ts_ms DESC);

COMMIT;
