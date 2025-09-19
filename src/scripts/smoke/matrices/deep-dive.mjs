// src/scripts/smoke/matrices/deep-dive.mjs
// One-stop, high-signal smoke: coins → preview → pipeline → head/latest → DB.
// Usage examples:
//   node src/scripts/smoke/matrices/deep-dive.mjs
//   BASE_URL=http://localhost:3000 node ... --verbose
//   DATABASE_URL=postgres://user:pass@host:5432/db node ... --verbose
//
// Notes:
// - Will start the pipeline (auto) and seed twice by default (fast).
// - If DATABASE_URL is present, it will verify counts at the API ts and show top rows.
// - No app file changes required.

try { const d = await import('dotenv'); d.config(); } catch {}

const BASE = process.env.BASE_URL || "http://localhost:3000";
const MATRIX_TABLE = process.env.MATRIX_TABLE || "dyn_matrix_values";
const VERBOSE = process.argv.includes("--verbose");

const TYPES = ["benchmark", "delta", "pct24h", "id_pct", "pct_drv"];
const DEFAULT_COINS = ["BTC","ETH","BNB","SOL","ADA","XRP","PEPE","USDT"];

const fetchFn = globalThis.fetch ?? (await import("node-fetch")).default;
const pp = (o) => JSON.stringify(o, null, 2);
const t = () => new Date().toISOString().split("T")[1].replace("Z","");

async function getJson(url, init) {
  const started = Date.now();
  const r = await fetchFn(url, init);
  const ms = Date.now() - started;
  let j = null;
  try { j = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, j, ms };
}
async function postJson(url, body) {
  return getJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body ?? {}),
  });
}

/** Resolve coins from live endpoints (latest → head → settings → env → default) */
async function resolveCoins() {
  // 1) /api/matrices/latest (preferred if it exposes coins)
  const L = await getJson(`${BASE}/api/matrices/latest`);
  if (L.ok && Array.isArray(L.j?.coins) && L.j.coins.length) {
    console.log(`[${t()}] [coins] ${L.j.coins.join(", ")} (source: /api/matrices/latest)`);
    return L.j.coins;
  }
  // 2) /api/matrices/head
  const H = await getJson(`${BASE}/api/matrices/head`);
  if (H.ok && Array.isArray(H.j?.coins) && H.j.coins.length) {
    console.log(`[${t()}] [coins] ${H.j.coins.join(", ")} (source: /api/matrices/head)`);
    return H.j.coins;
  }
  // 3) /api/settings
  const S = await getJson(`${BASE}/api/settings?scope=poller`);
  const sc = Array.isArray(S.j?.coins) ? S.j.coins : [];
  if (S.ok && sc.length) {
    console.log(`[${t()}] [coins] ${sc.join(", ")} (source: /api/settings)`);
    return sc;
  }
  // 4) env
  const envCoins = (process.env.COINS || "").split(",").map(s=>s.trim().toUpperCase()).filter(Boolean);
  if (envCoins.length) {
    console.log(`[${t()}] [coins] ${envCoins.join(", ")} (source: env:COINS)`);
    return envCoins;
  }
  // 5) fallback
  console.log(`[${t()}] [coins] ${DEFAULT_COINS.join(", ")} (source: fallback)`);
  return DEFAULT_COINS;
}

async function previewSymbols(coins) {
  const url = new URL(`${BASE}/api/preview/binance`);
  url.searchParams.set("coins", coins.join(","));
  const P = await getJson(url.toString());
  return { ...P, symbols: Array.isArray(P.j?.symbols) ? P.j.symbols : [] };
}

async function startAuto(coins) {
  const url = new URL(`${BASE}/api/pipeline/auto`);
  url.searchParams.set("immediate", "1");
  return postJson(url.toString(), { coins });
}

async function seedOnce() {
  return postJson(`${BASE}/api/pipeline/run-once`, {});
}

function compareCounts(nameA, rowsA, nameB, rowsB) {
  return Object.fromEntries(
    TYPES.map((t) => [t, {
      [nameA]: Number(rowsA?.[t] ?? 0),
      [nameB]: Number(rowsB?.[t] ?? 0),
      match: Number(rowsA?.[t] ?? 0) === Number(rowsB?.[t] ?? 0),
    }])
  );
}

async function dbProbe(ts) {
  const haveDb = !!process.env.DATABASE_URL;
  if (!haveDb) return { ok: false, reason: "DATABASE_URL not set" };

  const pg = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  const counts = {};
  for (const t of TYPES) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n
         FROM ${MATRIX_TABLE}
        WHERE matrix_type=$1 AND ts_ms=$2`,
      [t, ts]
    );
    counts[t] = rows?.[0]?.n ?? 0;
  }

  // top 5 for each type (helps confirm actual data)
  const tops = {};
  for (const t of TYPES) {
    const { rows } = await pool.query(
      `SELECT base, quote, value
         FROM ${MATRIX_TABLE}
        WHERE matrix_type=$1 AND ts_ms=$2
        ORDER BY value DESC NULLS LAST
        LIMIT 5`,
      [t, ts]
    );
    tops[t] = rows;
  }

  await pool.end();
  return { ok: true, table: MATRIX_TABLE, rowsAtTs: counts, tops };
}

(async () => {
  console.log("── matrices deep-dive ─────────────────────────────");

  const coins = await resolveCoins();

  // PREVIEW
  const P = await previewSymbols(coins);
  console.log(`[${t()}] [preview] ${P.ok ? "200" : P.status} symbols: ${P.symbols?.length ?? 0}`);
  if (VERBOSE && P.symbols?.length) {
    console.log("  sample:", P.symbols.slice(0, 12).join(", "));
  }

  // PIPELINE (start + two seeds)
  const A = await startAuto(coins);
  console.log(`[${t()}] [auto] start ${A.status}`, pp({ running: A.j?.running, nextAt: A.j?.state?.nextAt, lastRanAt: A.j?.state?.lastRanAt }));

  const S1 = await seedOnce();
  const S2 = await seedOnce();
  console.log(`[${t()}] [seed#1] ${S1.status}`, pp({ wrote: S1.j?.wrote, ts_ms: S1.j?.ts_ms }));
  console.log(`[${t()}] [seed#2] ${S2.status}`, pp({ wrote: S2.j?.wrote, ts_ms: S2.j?.ts_ms }));

  // HEAD
  const H = await getJson(`${BASE}/api/matrices/head`);
  if (!H.ok) {
    console.error(`[${t()}] [head] ${H.status}`, H.j);
    process.exit(1);
  }
  console.log(`[${t()}] [head] ${H.status}`, pp({ ts: H.j?.ts, rows: H.j?.rows, coins: H.j?.coins }));

  // LATEST
  const L = await getJson(`${BASE}/api/matrices/latest`);
  if (!L.ok) {
    console.error(`[${t()}] [latest] ${L.status}`, L.j);
    process.exit(1);
  }
  console.log(
    `[${t()}] [latest] ${L.status}`,
    pp({ ts: L.j?.ts, rows: L.j?.rows, coins: L.j?.coins, coinSource: L.j?.coinSource })
  );

  // Compare head vs latest
  const cmp = compareCounts("head", H.j?.rows, "latest", L.j?.rows);
  console.log("[compare head vs latest]", pp(cmp));

  const mismatch = Object.values(cmp).some(x => !x.match);
  const anyZeroLatest = TYPES.some(t => Number(L.j?.rows?.[t] ?? 0) === 0);

  // DB PROBE at API latest ts (pick any of the ts fields; they should all be equal)
  const apiTs = Number(L.j?.ts?.benchmark ?? 0);
  let DB = { ok: false, reason: "skipped" };
  if (apiTs > 0) {
    DB = await dbProbe(apiTs);
    if (DB.ok) {
      const cmpDb = compareCounts("api", L.j?.rows, "db", DB.rowsAtTs);
      console.log("[db probe]", pp({ table: DB.table, rowsAtTs: DB.rowsAtTs }));
      if (VERBOSE) console.log("[db tops]", pp(DB.tops));
      const misDb = Object.values(cmpDb).some(x => !x.match);
      if (misDb) {
        console.error("❌ DB counts do not match API 'latest' rows.");
        console.error(pp(cmpDb));
        process.exit(1);
      }
    } else if (VERBOSE) {
      console.log(`[db] skipped: ${DB.reason}`);
    }
  }

  // Verdicts
  if (mismatch) {
    console.error("❌ FAIL: head vs latest mismatch.");
    process.exit(1);
  }
  if (anyZeroLatest) {
    console.error("❌ FAIL: /api/matrices/latest has zero rows for at least one matrix type.");
    process.exit(1);
  }

  console.log("✅ PASS");
})();
