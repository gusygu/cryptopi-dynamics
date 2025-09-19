// src/core/db.ts
import pgPkg from "pg";
const { Pool } = pgPkg;

export type MatrixType = "benchmark" | "delta" | "pct24h" | "id_pct" | "pct_drv";

const TABLE = process.env.MATRIX_TABLE || "dyn_matrix_values";

// --- pool singleton for dev hot reload ---
declare global {
  // eslint-disable-next-line no-var
  var __dyn_db_pool__: InstanceType<typeof Pool> | undefined;
}
function makePool() {
  const cfg = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST || "localhost",
        port: Number(process.env.PGPORT || 5432),
        user: String(process.env.PGUSER || "postgres"),
        password: String(process.env.PGPASSWORD || ""),
        database: String(process.env.PGDATABASE || ""),
        ssl: process.env.PGSSL ? { rejectUnauthorized: false } : undefined,
      };
  return new Pool(cfg as any);
}
const pool: InstanceType<typeof Pool> =
  (global as any).__dyn_db_pool__ ?? makePool();
if (process.env.NODE_ENV !== "production") (global as any).__dyn_db_pool__ = pool;

// --- writes used by pipeline ---
export async function insertMatrixRows(
  ts_ms: number,
  matrix_type: MatrixType,
  rows: Array<{ base: string; quote: string; value: number; meta?: Record<string, any> }>
) {
  if (!rows?.length) return;
  const values: any[] = [];
  const chunks = rows.map((r, i) => {
    const j = i * 6;
    values.push(
      ts_ms,
      matrix_type,
      r.base.toUpperCase(),
      r.quote.toUpperCase(),
      r.value,
      JSON.stringify(r.meta ?? {})
    );
    return `($${j + 1}, $${j + 2}, $${j + 3}, $${j + 4}, $${j + 5}, $${j + 6})`;
  });
  const sql = `
    INSERT INTO ${TABLE} (ts_ms, matrix_type, base, quote, value, meta)
    VALUES ${chunks.join(",")}
    ON CONFLICT (ts_ms, matrix_type, base, quote)
    DO UPDATE SET value = EXCLUDED.value, meta = EXCLUDED.meta;
  `;
  await pool.query(sql, values);
}

// --- reads used by latest/head ---
export async function getLatestTsForType(t: MatrixType): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT MAX(ts_ms) AS ts FROM ${TABLE} WHERE matrix_type = $1`,
    [t]
  );
  const ts = rows?.[0]?.ts;
  return ts == null ? null : Number(ts);
}

export async function getSnapshotByType(
  t: MatrixType,
  ts_ms: number,
  coins: string[]
): Promise<Array<{ base: string; quote: string; value: number }>> {
  const U = coins.map(c => c.toUpperCase());
  const { rows } = await pool.query(
    `SELECT base, quote, value
       FROM ${TABLE}
      WHERE matrix_type = $1
        AND ts_ms = $2
        AND UPPER(base)  = ANY($3)
        AND UPPER(quote) = ANY($3)`,
    [t, ts_ms, U]
  );
  return rows as Array<{ base: string; quote: string; value: number }>;
}

export async function countSnapshotByType(
  t: MatrixType,
  ts_ms: number,
  coins: string[]
): Promise<number> {
  const U = coins.map(c => c.toUpperCase());
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n
       FROM ${TABLE}
      WHERE matrix_type = $1
        AND ts_ms = $2
        AND UPPER(base)  = ANY($3)
        AND UPPER(quote) = ANY($3)`,
    [t, ts_ms, U]
  );
  return rows?.[0]?.n ?? 0;
}

/** NEW: fetch ALL rows at a ts (no coin filter). */
export async function getSnapshotAllByType(
  t: MatrixType,
  ts_ms: number
): Promise<Array<{ base: string; quote: string; value: number }>> {
  const { rows } = await pool.query(
    `SELECT base, quote, value
       FROM ${TABLE}
      WHERE matrix_type = $1
        AND ts_ms = $2`,
    [t, ts_ms]
  );
  return rows as Array<{ base: string; quote: string; value: number }>;
}

export async function getPrevSnapshotByType(
  t: MatrixType,
  ts_ms: number,
  coins: string[]
): Promise<{ ts: number | null; rows: Array<{ base: string; quote: string; value: number }> }> {
  const { rows: r1 } = await pool.query(
    `SELECT MAX(ts_ms) AS ts
       FROM ${TABLE}
      WHERE matrix_type = $1
        AND ts_ms < $2`,
    [t, ts_ms]
  );
  const prevTs = r1?.[0]?.ts;
  if (prevTs == null) return { ts: null, rows: [] };
  const U = coins.map(c => c.toUpperCase());
  const { rows } = await pool.query(
    `SELECT base, quote, value
       FROM ${TABLE}
      WHERE matrix_type = $1
        AND ts_ms = $2
        AND UPPER(base)  = ANY($3)
        AND UPPER(quote) = ANY($3)`,
    [t, Number(prevTs), U]
  );
  return { ts: Number(prevTs), rows: rows as Array<{ base: string; quote: string; value: number }> };
}
