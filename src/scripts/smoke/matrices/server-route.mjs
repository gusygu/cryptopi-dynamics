// src/scripts/smoke/matrices/server-route.mjs
// Validates that /api/matrices/server (or /api/matrices) returns non-zero rows across all types

// Optional .env loading
try { const d = await import('dotenv'); d.config(); } catch {}

const BASE = process.env.BASE_URL || "http://localhost:3000";
const TYPES = ["benchmark", "delta", "pct24h", "id_pct", "pct_drv"];
const fetchFn = globalThis.fetch ?? (await import("node-fetch")).default;
const pp = (o) => JSON.stringify(o, null, 2);

async function getJson(url) {
  const r = await fetchFn(url, { headers: { "cache-control": "no-store" } });
  let j = null;
  try { j = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, j };
}

(async () => {
  console.log("── /api/matrices/server check ──");

  // Prefer the legacy alias if it exists; otherwise fall back to /api/matrices
  let r = await getJson(`${BASE}/api/matrices/server`);
  if (r.status === 404) r = await getJson(`${BASE}/api/matrices`);

  if (!r.ok) {
    console.error(`[server/matrices] ${r.status}`, r.j);
    process.exit(1);
  }

  const meta = {
    ok: r.j?.ok,
    coinSource: r.j?.coinSource,
    rows: r.j?.rows,
    ts: r.j?.ts,
  };
  console.log("[route]", pp(meta));

  const missing = TYPES.some((t) => Number(r.j?.rows?.[t] ?? 0) === 0);
  if (missing) {
    console.error("❌ FAIL: server route has 0 rows for at least one matrix type");
    process.exit(1);
  }

  console.log("✅ PASS");
})();
