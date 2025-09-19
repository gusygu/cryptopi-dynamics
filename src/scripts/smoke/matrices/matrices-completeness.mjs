// src/scripts/smoke/matrices/matrices-completeness.mjs
// Ensures /api/matrices mirrors /api/matrices/latest row counts

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
  console.log("── /api/matrices completeness ──");

  const A = await getJson(`${BASE}/api/matrices`);
  if (!A.ok) {
    console.error(`[matrices] ${A.status}`, A.j);
    process.exit(1);
  }

  const B = await getJson(`${BASE}/api/matrices/latest`);
  if (!B.ok) {
    console.error(`[latest] ${B.status}`, B.j);
    process.exit(1);
  }

  const cmp = Object.fromEntries(
    TYPES.map((t) => {
      const a = Number(A.j?.rows?.[t] ?? 0);
      const b = Number(B.j?.rows?.[t] ?? 0);
      return [t, { matrices: a, latest: b, match: a === b }];
    })
  );

  console.log("[compare /matrices vs /latest]", pp(cmp));
  const bad = Object.values(cmp).some((x) => !x.match);

  if (bad) {
    console.error("❌ FAIL: /api/matrices row counts differ from /api/matrices/latest");
    process.exit(1);
  }

  console.log("✅ PASS");
})();
