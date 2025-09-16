// src/scripts/smoke/db-health.mjs
/* eslint-disable no-console */
import pg from "pg";

const DB_URL = process.env.DATABASE_URL || "";
if (!DB_URL) {
  console.error("DATABASE_URL not set");
  process.exit(2);
}
const db = new pg.Pool({ connectionString: DB_URL, max: 2 });

(async () => {
  const kinds = ["benchmark","delta","pct24h","id_pct","pct_drv"];
  console.log("── db-health: dyn_matrix_values ──");
  const { rows: all } = await db.query(
    `select matrix_type, count(*)::int as n, max(ts_ms)::bigint as ts
       from dyn_matrix_values
      group by 1 order by 1`
  );
  console.table(all);

  for (const k of kinds) {
    const { rows } = await db.query(
      `select max(ts_ms)::bigint as ts from dyn_matrix_values where matrix_type=$1`,
      [k]
    );
    const ts = rows?.[0]?.ts ?? null;
    if (ts) {
      const { rows: c } = await db.query(
        `select count(*)::int as n from dyn_matrix_values where matrix_type=$1 and ts_ms=$2`,
        [k, ts]
      );
      console.log(k, "latest ts", ts, "rows@", c?.[0]?.n ?? 0);
    } else {
      console.log(k, "no rows");
    }
  }
  await db.end();
})().catch(e => { console.error(e); process.exit(1); });
