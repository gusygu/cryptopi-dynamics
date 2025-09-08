import pgPkg from 'pg';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
const { Pool } = pgPkg;

/**
 * ---------------------------------------------------------------------
 *  MATRIX TABLE RESOLUTION (kept from dynamics-matrices)
 * ---------------------------------------------------------------------
 */
// Optional env override; defaults to our clean table
const RAW_TABLE = process.env.MATRIX_TABLE || 'dyn_matrix_values';

// Prevent SQL injection on identifier
function asIdent(name: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid table identifier: ${name}`);
  }
  return `"${name}"`;
}
const TABLE = asIdent(RAW_TABLE);

/**
 * ---------------------------------------------------------------------
 *  POOL CONFIG (hardened)
 *  - Works with DATABASE_URL (URL-encode password if it has @:/?#%)
 *  - Or with discrete PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
 *  - Optional PGSSL=true for managed DBs
 * ---------------------------------------------------------------------
 */
function bool(v: any) { return String(v).toLowerCase() === 'true'; }

const useUrl = !!process.env.DATABASE_URL;
const basePoolConfig = useUrl
  ? {
      connectionString: String(process.env.DATABASE_URL),      // ensure string
    }
  : {
      host:      String(process.env.PGHOST ?? 'localhost'),
      port:      Number(process.env.PGPORT ?? 5432),
      user:      String(process.env.PGUSER ?? ''),
      password:  String(process.env.PGPASSWORD ?? ''),         // ensure string → fixes SASL error
      database:  String(process.env.PGDATABASE ?? ''),
    };

const poolConfig = {
  ...basePoolConfig,
  max: Number(process.env.PGPOOL_MAX ?? 10),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30_000),
  ssl: bool(process.env.PGSSL) ? { rejectUnauthorized: false } : undefined,
};

/**
 * ---------------------------------------------------------------------
 *  PRIMARY POOLS (back-compat + Next.js dev hot-reload safe)
 *  - `pool`: direct pool (kept for existing matrix writers)
 *  - `db`: globally-cached pool for API routes / builders
 * ---------------------------------------------------------------------
 */
export const pool = new Pool(poolConfig as any);

declare global {
  // eslint-disable-next-line no-var
  var __dbPool__: InstanceType<typeof Pool> | undefined;
}

export const db: InstanceType<typeof Pool> =
  (global as any).__dbPool__ ?? new Pool(poolConfig as any);

if (process.env.NODE_ENV !== 'production') {
  (global as any).__dbPool__ = db;
}

/**
 * ---------------------------------------------------------------------
 *  LIGHT HELPERS (non-breaking)
 * ---------------------------------------------------------------------
 */
export async function withClient<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await db.connect();
  try { return await fn(client); }
  finally { client.release(); }
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  return db.query<T>(text, params);}

/**
 * ---------------------------------------------------------------------
 *  DYNAMICS-MATRICES COMPATIBLE API (unchanged signatures)
 * ---------------------------------------------------------------------
 */
export async function upsertMatrixRows(rows: {
  ts_ms: number;
  matrix_type: 'benchmark'|'delta'|'pct24h'|'id_pct'|'pct_drv';
  base: string;
  quote: string;
  value: number;
  meta?: Record<string, any>;
}[]) {
  if (!rows.length) return;
  const client = await pool.connect();
  try {
    const values: any[] = [];
    const chunks = rows.map((r, i) => {
      const j = i * 6;
      values.push(
        r.ts_ms, r.matrix_type, r.base, r.quote, r.value,
        JSON.stringify(r.meta ?? {})
      );
      return `($${j+1}, $${j+2}, $${j+3}, $${j+4}, $${j+5}, $${j+6})`;
    }).join(',');

    const sql = `
      INSERT INTO ${TABLE} (ts_ms, matrix_type, base, quote, value, meta)
      VALUES ${chunks}
      ON CONFLICT (ts_ms, matrix_type, base, quote)
      DO UPDATE SET value = EXCLUDED.value, meta = EXCLUDED.meta;
    `;
    await client.query(sql, values);
  } finally {
    client.release();
  }
}

export async function getLatestByType(matrix_type: string, coins: string[]) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT ts_ms FROM ${TABLE} WHERE matrix_type=$1 ORDER BY ts_ms DESC LIMIT 1`,
      [matrix_type]
    );
    if (!rows.length) return { ts_ms: null, values: [] as any[] };
    const ts_ms = Number(rows[0].ts_ms);
    const { rows: vals } = await client.query(
      `SELECT base, quote, value FROM ${TABLE}
       WHERE matrix_type=$1 AND ts_ms=$2 AND base = ANY($3) AND quote = ANY($3)`,
      [matrix_type, ts_ms, coins]
    );
    return { ts_ms, values: vals };
  } finally {
    client.release();
  }
}

export async function getPrevValue(matrix_type: string, base: string, quote: string, beforeTs: number) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT value FROM ${TABLE}
       WHERE matrix_type=$1 AND base=$2 AND quote=$3 AND ts_ms < $4
       ORDER BY ts_ms DESC LIMIT 1`,
      [matrix_type, base, quote, beforeTs]
    );
    return rows.length ? Number(rows[0].value) : null;
  } finally {
    client.release();
  }
}

export async function getLatestTsForType(matrix_type: string) {
  const { rows } = await pool.query(
    `SELECT MAX(ts_ms) AS ts_ms FROM ${TABLE} WHERE matrix_type=$1`,
    [matrix_type]
  );
  const v = rows[0]?.ts_ms;
  return v == null ? null : Number(v);
}

export async function getNearestTsAtOrBefore(matrix_type: string, ts_ms: number) {
  const { rows } = await pool.query(
    `SELECT ts_ms FROM ${TABLE}
     WHERE matrix_type=$1 AND ts_ms <= $2
     ORDER BY ts_ms DESC LIMIT 1`,
    [matrix_type, ts_ms]
  );
  const v = rows[0]?.ts_ms;
  return v == null ? null : Number(v);
}

export async function getSnapshotByType(matrix_type: string, ts_ms: number, coins: string[]) {
  const { rows } = await pool.query(
    `SELECT base, quote, value FROM ${TABLE}
     WHERE matrix_type=$1 AND ts_ms=$2 AND base = ANY($3) AND quote = ANY($3)`,
    [matrix_type, ts_ms, coins]
  );
  return rows as { base:string; quote:string; value:number }[];
}

export async function getPrevSnapshotByType(
  matrix_type: string,
  beforeTs: number,
  coins: string[]
) {
  const { rows } = await pool.query(
    `
    SELECT DISTINCT ON (base, quote) base, quote, value
    FROM ${TABLE}
    WHERE matrix_type=$1
      AND ts_ms < $2
      AND base  = ANY($3)
      AND quote = ANY($3)
    ORDER BY base, quote, ts_ms DESC
    `,
    [matrix_type, beforeTs, coins]
  );
  return rows as { base: string; quote: string; value: number }[];
}

export async function countRowsAt(matrix_type: string, ts_ms: number) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM ${TABLE} WHERE matrix_type=$1 AND ts_ms=$2`,
    [matrix_type, ts_ms]
  );
  return rows[0]?.n ?? 0;
}
