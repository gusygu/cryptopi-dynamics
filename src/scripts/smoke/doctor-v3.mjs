// src/scripts/smoke/doctor-v3.mjs
/* eslint-disable no-console */
import pg from "pg";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const COINS = (process.env.COINS || "BTC,ETH,BNB,SOL,ADA,XRP,PEPE,USDT")
  .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);

/** ───────── HTTP helpers ───────── */
async function j(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let txt = await res.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { json = null; }
  return { status: res.status, ok: res.ok, json };
}
const get = (p) => j("GET", p);
const post = (p, b) => j("POST", p, b);

/** ───────── DB helpers (direct) ───────── */
const DB_URL = process.env.DATABASE_URL || "";
const db = DB_URL ? new pg.Pool({ connectionString: DB_URL, max: 2 }) : null;

async function q(sql, params = []) {
  if (!db) return { rows: [], rowCount: 0 };
  const c = await db.connect();
  try { return await c.query(sql, params); } finally { c.release(); }
}

async function getLatestTsFromDb(kind) {
  const { rows } = await q(
    `select max(ts_ms)::bigint as ts from dyn_matrix_values where matrix_type=$1`,
    [kind]
  );
  return rows?.[0]?.ts ?? null;
}

async function countRowsAt(kind, ts, bases, quotes) {
  const { rows } = await q(
    `select count(*)::int as n
       from dyn_matrix_values
      where matrix_type=$1 and ts_ms=$2
        and base = any($3) and quote = any($4)`,
    [kind, ts, bases, quotes]
  );
  return rows?.[0]?.n ?? 0;
}

/** ───────── math helpers for grid checks ───────── */
function combos(coins) {
  const out = [];
  for (let i = 0; i < coins.length; i++)
    for (let j = 0; j < coins.length; j++)
      if (i !== j) out.push([coins[i], coins[j]]);
  return out;
}

function makeIndex(coins) {
  const idx = Object.create(null);
  coins.forEach((c, i) => { idx[c] = i; });
  return idx;
}

function coverageOf(grid) {
  let filled = 0, total = 0;
  for (const row of grid) {
    for (const v of row) { total++; if (v !== null && Number.isFinite(+v)) filled++; }
  }
  return { filled, total, coverage: (100 * filled / total).toFixed(1) + "%" };
}

function antisymMismatches(grid, tol = 1e-10) {
  const n = grid.length;
  let bad = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const a = grid[i][j];
      const b = grid[j][i];
      if (a == null || b == null) continue;
      if (Math.abs((+a) + (+b)) > tol) bad++;
    }
  return bad;
}

/** classify rings against preview list */
function classifyRings(previewSymbols, coins) {
  const set = new Set(previewSymbols);
  const pairs = combos(coins);
  let direct = 0, inverseOnly = 0, none = 0;
  for (const [b,q] of pairs) {
    const p = `${b}${q}`;
    const inv = `${q}${b}`;
    if (set.has(p)) direct++;
    else if (set.has(inv)) inverseOnly++;
    else none++;
  }
  return { direct, inverseOnly, none };
}

function gridOr(obj, key) {
  // tolerate both { benchmark: number[][] } and { matrices: {benchmark:...} }
  if (Array.isArray(obj?.[key])) return obj[key];
  if (Array.isArray(obj?.matrices?.[key])) return obj.matrices[key];
  return null;
}

function tsBag(obj) {
  // tolerate { ts: {...} } or { timestamps:{...} }
  return obj?.ts || obj?.timestamps || {};
}

/** ───────── run ───────── */
(async () => {
  console.log("── doctor: matrices + pipeline + latest (v3) ─────────────────────────");
  console.log("[coins]", COINS.join(", "));

  // 1) Preview
  const pv = await get(`/api/preview/binance?coins=${encodeURIComponent(COINS.join(","))}`);
  const previewSymbols = Array.isArray(pv.json?.symbols) ? pv.json.symbols : [];
  console.log("[preview] symbols:", previewSymbols.length);

  // 2) Pipeline auto status + start + seed twice
  const st0 = await get(`/api/pipeline/auto`);
  console.log("[auto] status", st0.status, st0.json);

  const started = await post(`/api/pipeline/auto?immediate=1`);
  console.log("[auto] start", started.status, started.json);

  const seed1 = await post(`/api/pipeline/run-once`);
  console.log("[seed#1]", seed1.status, seed1.json);

  const head1 = await get(`/api/matrices/head`);
  console.log("[head#1]", head1.status, head1.json);

  // brief pause
  await new Promise(r => setTimeout(r, 900));

  const seed2 = await post(`/api/pipeline/run-once`);
  console.log("[seed#2]", seed2.status, seed2.json);

  const head2 = await get(`/api/matrices/head`);
  console.log("[head#2]", head2.status, head2.json);

  const advanced = {};
  for (const k of ["benchmark","delta","pct24h","id_pct","pct_drv"]) {
    const a = Number(head1.json?.ts?.[k] ?? 0);
    const b = Number(head2.json?.ts?.[k] ?? 0);
    advanced[k] = Number.isFinite(a) && Number.isFinite(b) && b > a;
  }
  console.log("[head advanced?]", advanced);

  // 3) Latest snapshot (API)
  const qs = new URLSearchParams({ coins: COINS.join(",") }).toString();
  const latest = await get(`/api/matrices/latest?${qs}`);
  const latestTs = tsBag(latest.json);
  console.log("[latest] status", latest.status, "ts:", latestTs);

  // 4) Coverage + antisymmetry from latest grids
  const out = {};
  const grids = {
    benchmark: gridOr(latest.json, "benchmark"),
    delta:     gridOr(latest.json, "delta"),
    pct24h:    gridOr(latest.json, "pct24h"),
    id_pct:    gridOr(latest.json, "id_pct"),
    pct_drv:   gridOr(latest.json, "pct_drv"),
  };
  for (const k of Object.keys(grids)) {
    const g = grids[k];
    if (Array.isArray(g)) {
      const cov = coverageOf(g);
      const bad = antisymMismatches(g);
      out[k] = { filled: `${cov.filled}/${cov.total}`, coverage: cov.coverage, antisymBad: bad };
    } else {
      out[k] = { filled: "0/0", coverage: "0.0%", antisymBad: 0 };
    }
  }
  console.log("────────────────────────────────────────────────────────");
  console.log("[coverage]", out);

  // Rings expectation vs preview
  const ringExp = classifyRings(previewSymbols, COINS);
  console.log("[rings] expected", ringExp, "bridgePossible", (COINS.length * (COINS.length-1)) - (ringExp.direct + ringExp.inverseOnly));

  // 5) DB reality (if DATABASE_URL is set)
  if (db) {
    const tsDb = {};
    for (const k of ["benchmark","delta","pct24h","id_pct","pct_drv"]) {
      tsDb[k] = await getLatestTsFromDb(k);
    }
    console.log("[db latest ts]", tsDb);

    const rowsDb = {};
    for (const k of ["benchmark","delta","pct24h","id_pct","pct_drv"]) {
      const t = tsDb[k];
      rowsDb[k] = t ? await countRowsAt(k, t, COINS, COINS) : 0;
    }
    console.log("[db rows@latest]", rowsDb);
  }

  // 6) UI pings
  const ui = await Promise.all([
    get("/matrices"),
    get("/dynamics"),
    get("/str-aux"),
  ]);
  console.log("────────────────────────────────────────────────────────");
  console.log("[ui]", ...ui.map((r,i) => (i===0?"/matrices":i===1?"/dynamics":"/str-aux") + " " + r.status));

  // 7) Verdicts + hints
  // Head rows zero?
  const headRowsZero = Object.values(head2.json?.rows || {}).every(n => Number(n) === 0);
  const headTsStale = Object.values(advanced).every(v => !v);

  let fail = false;
  if (headRowsZero || headTsStale) fail = true;
  if (!Array.isArray(grids.benchmark)) fail = true;

  console.log("[verdict]", fail ? "❌ FAIL" : "✅ PASS");
  if (fail) {
    console.log("Hints:");
    if (headRowsZero) {
      console.log(" - HEAD rows are 0. Verify writer persists into dyn_matrix_values and HEAD reads the same table.");
    }
    if (headTsStale) {
      console.log(" - HEAD timestamps did not advance between seeds. Check pipeline writer → DB and timestamp used in /api/matrices/head.");
    }
    if (out.id_pct?.antisymBad || out.pct_drv?.antisymBad) {
      console.log(" - Antisymmetry mismatches in id_pct/pct_drv. Ensure inverse fill & USDT-bridge run AFTER base triangle populate.");
    }
    if (!Array.isArray(grids.benchmark)) {
      console.log(" - /api/matrices/latest didn’t return grids. Confirm route wiring to core/matricesLatest and parameter coins passthrough.");
    }
  }

  if (db) await db.end();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
