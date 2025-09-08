import { pool } from '@/core/db';

async function main() {
  // Allow passing a table name: pnpm run db:inspect dyn_matrix_values
  const table = (process.argv[2] || 'dyn_matrix_values').toLowerCase();

  const client = await pool.connect();
  try {
    console.log('--- columns in', table);
    const cols = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position
    `, [table]);
    console.table(cols.rows);

    console.log('--- constraints on', table);
    const cons = await client.query(`
      SELECT conname, contype
      FROM pg_constraint
      WHERE conrelid = $1::regclass
    `, [table]);
    console.table(cons.rows);

    console.log('--- indexes on', table);
    const idx = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = $1
    `, [table]);
    console.table(idx.rows);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
