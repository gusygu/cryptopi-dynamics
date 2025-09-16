// scripts/ddl.ts  (new) - cross-platform DDL executor
import { readFileSync } from 'fs';
import { pool } from '@/core/db';

async function main() {
  // align to actual repo path
  const sql = readFileSync('src/db/dd.l.sql', 'utf8');
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('[ddl] schema applied');
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(err => { console.error(err); process.exit(1); });
