import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pgPkg from 'pg';
const { Pool } = pgPkg;

function firstExisting(paths) {
  for (const p of paths) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

const cwd = process.cwd();
// allow arg or env
const argPath = process.argv[2] ? path.resolve(cwd, process.argv[2]) : null;
const envPath = process.env.DDL_PATH ? path.resolve(cwd, process.env.DDL_PATH) : null;

// common fallbacks
const fallbacks = [
  argPath,
  envPath,
  path.resolve(cwd, 'scripts/db/ddl-aux.sql'),
  path.resolve(cwd, 'src/scripts/db/ddl-aux.sql'),
  path.resolve(cwd, 'src/db/ddl-aux.sql'),
  path.resolve(cwd, 'db/ddl-aux.sql'),
];

const sqlPath = firstExisting(fallbacks);
if (!sqlPath) {
  console.error('[migrate] ddl-aux.sql not found. Tried:\n - ' + fallbacks.filter(Boolean).join('\n - '));
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, 'utf8');
console.log('[migrate] applying:', sqlPath);

const db = new Pool({
  connectionString: String(process.env.DATABASE_URL || ''),
  max: Number(process.env.PGPOOL_MAX ?? 4),
  ssl: String(process.env.PGSSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
});

try {
  await db.query(sql);
  console.log('[migrate] done');
} catch (err) {
  console.error('[migrate] failed:', err?.message || err);
  process.exitCode = 1;
} finally {
  await db.end();
}
