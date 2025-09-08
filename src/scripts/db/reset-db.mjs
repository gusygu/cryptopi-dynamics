import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

const KEEP = new Set(['coins', 'schema_migrations']); // keep reference tables

async function main(){
  const { rows } = await db.query(`
    select tablename
    from pg_tables
    where schemaname='public'
  `);
  const tables = rows.map(r=>r.tablename).filter(t=>!KEEP.has(t));

  // TRUNCATE in one statement, restart identities, cascade
  if (tables.length) {
    const list = tables.map(t => `"public"."${t}"`).join(', ');
    console.log('[reset-db] truncating:', list);
    await db.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  }

  // optional: reinsert common coins if needed
  // await db.query(`insert into coins(symbol) values ('BTC'),('ETH'),('USDT') on conflict do nothing`);

  console.log('[reset-db] done');
  await db.end();
}
main().catch(e=>{ console.error(e); process.exit(1); });
