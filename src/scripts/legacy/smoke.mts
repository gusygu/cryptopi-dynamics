// src/scripts/str-aux/smoke.mts
// Run with: pnpm tsx -r dotenv/config -r tsconfig-paths/register src/scripts/str-aux/smoke.mts

import { Pool } from "pg";

// ------------- config -------------
const API = process.env.STR_AUX_API ?? "http://localhost:3000/api/str-aux";
const DATABASE_URL = process.env.DATABASE_URL;

// ------------- helpers -------------
function assertEnv() {
  if (!DATABASE_URL) {
    console.error("❌ DATABASE_URL missing. Put it in .env.local or set PG* vars and adapt db.ts.");
    process.exit(1);
  }
}
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ------------- main -------------
(async () => {
  assertEnv();
  const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });

  // 1) Apply DDL
  const ddlSql = await (await import("node:fs/promises")).readFile("src/db/ddl-str.sql", "utf8");
  try {
    await pool.query(ddlSql);
    console.log("✅ DDL applied (str_aux_docs ready)");
  } catch (e) {
    console.error("❌ DDL failed:", e);
    process.exit(1);
  }

  // 2) POST payload → compute + upsert
  const payload = {
    pair: { base: "BTC", quote: "USDT", window: "30m", appSessionId: "smoke-session" },
    opening: { benchmark: 1.0, pct24h: 0.012, pct_drv: 0.003, ts: Date.now(), layoutHash: "smoke" },
    points: [
      { price: 60000, volume: 3, ts: 1 },
      { price: 60020, volume: 2, ts: 2 },
      { price: 59990, volume: 4, ts: 3 },
      { price: 60050, volume: 3, ts: 4 },
      { price: 60010, volume: 5, ts: 5 },
    ],
    metrics: {
      benchmarkPrev: 0.98, benchmarkCur: 1.01,
      pct24hPrev: 0.010, pct24hCur: 0.012,
      pct_drvPrev: 0.002, pct_drvCur: 0.003,
    },
  };

  const postRes = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const postJson = await postRes.json();
  if (!postRes.ok) {
    console.error("❌ POST failed:", postJson);
    process.exit(1);
  }
  console.log("✅ POST ok → computed doc id:", postJson.id);

  // 3) Query DB directly to verify persistence
  await sleep(250);
  const { rows } = await pool.query(
    `select id, opening, nuclei, stats, stream
       from str_aux_docs
      where pair_base = $1 and pair_quote = $2 and window_key = $3 and app_session_id = $4
      order by updated_at desc limit 1`,
    ["BTC", "USDT", "30m", "smoke-session"],
  );
  if (rows.length === 0) {
    console.error("❌ DB row not found");
    process.exit(1);
  }
  const row = rows[0];
  console.log("✅ DB row found:", row.id);
  console.log("   nuclei:", Array.isArray(row.nuclei) ? row.nuclei.length : row.nuclei?.length ?? "n/a");
  console.log("   stats.gfm:", row.stats?.gfm, "Δ:", row.stats?.deltaGfm, "shift:", row.stats?.shifted);

  // 4) GET via API to confirm read path
  const qs = new URLSearchParams({ base: "BTC", quote: "USDT", window: "30m", appSessionId: "smoke-session" });
  const getRes = await fetch(`${API}?${qs.toString()}`);
  const getJson = await getRes.json();
  if (!getRes.ok || !getJson) {
    console.error("❌ GET failed:", getJson);
    process.exit(1);
  }
  console.log("✅ GET ok; stats:", {
    gfm: getJson?.stats?.gfm,
    deltaGfm: getJson?.stats?.deltaGfm,
    shifted: getJson?.stats?.shifted,
  });

  await pool.end();
  console.log("🎉 SMOKE PASS");
})().catch((e) => {
  console.error("❌ Smoke crashed:", e);
  process.exit(1);
});
