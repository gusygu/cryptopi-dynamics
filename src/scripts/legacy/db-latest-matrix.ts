import 'dotenv/config';
import { pool } from '@/core/db';

async function main() {
  const { rows } = await pool.query(
    `select matrix_type, max(ts_ms) as ts
       from dyn_matrix_values
      group by matrix_type
      order by matrix_type`
  );
  for (const r of rows) {
    const ts = Number(r.ts);
    console.log(`${r.matrix_type}: ${ts} (${new Date(ts).toISOString()})`);
  }
  await pool.end();
}

main().catch(e=>{ console.error(e); process.exit(1); });

