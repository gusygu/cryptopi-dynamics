// src/scripts/smoke/matrices/head-route.mjs
// Checks that /api/matrices/head row counts match /api/matrices/latest

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
  console.log("── /api/matrices/head check ──");

  const head = await getJson(`${BASE}/api/matrices/head`);
  if (!head.ok) {
    console.error(`[head] ${head.status}`, head.j);
    process.exit(1);
  }
  console.log("[head]", pp({ ts: head.j?.ts, rows: head.j?.rows, coins: head.j?.coins }));

  const latest = await getJson(`${BASE}/api/matrices/latest`);
  if (!latest.ok) {
    console.error(`[latest] ${latest.status}`, latest.j);
    process.exit(1);
  }
  console.log("[latest]", pp({ ts: latest.j?.ts, rows: latest.j?.rows, coins: latest.j?.coins }));

  const mismatch = Object.fromEntries(
    TYPES.map((t) => {
      const h = Number(head.j?.rows?.[t] ?? 0);
      const l = Number(latest.j?.rows?.[t] ?? 0);
      return [t, { head: h, latest: l, match: h === l }];
    })
  );

  console.log("[compare head vs latest]", pp(mismatch));
  const bad = Object.values(mismatch).some((x) => !x.match);

  if (bad) {
    console.error("❌ FAIL: head rows != latest rows for at least one matrix type");
    process.exit(1);
  }

  console.log("✅ PASS");
})();
