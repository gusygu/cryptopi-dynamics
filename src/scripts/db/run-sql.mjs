// scripts/db/run-sql.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadDotEnv() {
  const p = path.join(process.cwd(), ".env");
  if (!fs.existsSync(p)) return;
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
  for (const ln of lines) {
    const m = ln.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const k = m[1]; let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadDotEnv();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set (place it in .env).");
  process.exit(1);
}

const fileArg = process.argv[2] || "scripts/db/ddl-aux.sql";
const sqlPath = path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg);
if (!fs.existsSync(sqlPath)) {
  console.error(`SQL file not found: ${sqlPath}`);
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, "utf8");
const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: process.env.DB_SSL === "1" ? { rejectUnauthorized: false } : undefined
});

(async () => {
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log(`✅ Applied ${path.relative(process.cwd(), sqlPath)}`);
    process.exit(0);
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("❌ SQL apply failed:", err?.message || err);
    process.exit(1);
  } finally {
    try { await client.end(); } catch {}
  }
})();
