// src/scripts/db/run-ddl.cjs
const fs = require("node:fs");
const path = require("node:path");
try {
  // optional .env loader (does nothing if not installed or file missing)
  require("dotenv").config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });
} catch (_) {}

const { Client } = require("pg");

const DIR = process.env.DDL_DIR || "src/db";
const FILES = (process.env.DDL_FILES || "ddl.sql,ddl-aux.sql,ddl-str.sql")
  .split(",").map(s => s.trim()).filter(Boolean);

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Set it in .env/.env.local or the shell.");
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    await client.query("BEGIN");
    for (const f of FILES) {
      const p = path.join(DIR, f);
      const sql = fs.readFileSync(p, "utf8");
      console.log(`[DDL] ${f} (${sql.length} bytes)`);
      await client.query(sql);
    }
    await client.query("COMMIT");
    console.log("[DDL] done ✅");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[DDL] failed ❌", e.message || e);
    process.exit(2);
  } finally {
    await client.end();
  }
})();
