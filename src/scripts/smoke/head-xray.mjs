#!/usr/bin/env node
/* eslint-disable no-console */

// ---- env / constants ---------------------------------------------------------
const BASE = process.env.BASE_URL || "http://localhost:3000";
const DBURL = process.env.DATABASE_URL || "";
const TYPES = ["benchmark", "delta", "pct24h", "id_pct", "pct_drv"];
const SLEEP = ms => new Promise(r => setTimeout(r, ms));

async function jget(path) {
  const r = await fetch(`${BASE}${path}`, { cache: "no-store" });
  const txt = await r.text();
  let body = null;
  try { body = txt ? JSON.parse(txt) : null; } catch { body = txt; }
  return { status: r.status, ok: r.ok, body };
}
async function jpost(path, payload) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const txt = await r.text();
  let body = null;
  try { body = txt ? JSON.parse(txt) : null; } catch { body = txt; }
  return { status: r.status, ok: r.ok, body };
}

function normCoins(arr) {
  const set = new Set(), out = [];
  for (const c of arr || []) {
    const u = String(c || "").trim().toUpperCase();
    if (!u || set.has(u)) continue;
    set.add(u);
    out.push(u);
  }
  if (!set.has("USDT")) out.push("USDT");
  return out;
}

async function getSettingsCoins() {
  const { status, body } = await jget("/api/settings");
  if (status !== 200 || !body) return normCoins(["BTC","ETH","BNB","SOL","ADA","XRP","PEPE","USDT"]);
  const from =
    (Array.isArray(body?.coinUniverse) && body.coinUniverse) ||
    (Array.isArray(body?.coins) && body.coins) ||
    [];
  const coins = normCoins(from);
  return coins.length ? coins : normCoins(["BTC","ETH","BNB","SOL","ADA","XRP","PEPE","USDT"]);
}

function qsCoins(coins) {
  return `?coins=${encodeURIComponent(coins.join(","))}`;
}

async function dbProbe(tsByType, coins) {
  if (!DBURL) return { ok: false, reason: "DATABASE_URL not set" };
  const { Client } = await import("pg");
  const client = new Client({ connectionString: DBURL });
  await client.connect();

  const U = coins.map(c => c.toUpperCase());
  const res = {
    ok: true,
    table: process.env.MATRIX_TABLE || "dyn_matrix_values",
    rowsAtApiTs: {},
    rowsAtDbMaxTs: {},
    latestTs: {},
  };

  // Per type: (1) count at API ts (2) db MAX(ts) and count there
  for (const t of TYPES) {
    // 1) rows at API ts
    let r1 = await client.query(
      `SELECT COUNT(*)::int AS n
         FROM ${res.table}
        WHERE matrix_type = $1
          AND ts_ms = $2
          AND UPPER(base) = ANY($3)
          AND UPPER(quote)= ANY($3)`,
      [t, tsByType[t], U]
    );
    res.rowsAtApiTs[t] = r1.rows?.[0]?.n ?? 0;

    // 2) db max ts
    let rTs = await client.query(
      `SELECT MAX(ts_ms)::bigint AS ts FROM ${res.table} WHERE matrix_type = $1`,
      [t]
    );
    const maxTs = Number(rTs.rows?.[0]?.ts ?? 0);
    res.latestTs[t] = maxTs || null;

    let r2 = { rows: [{ n: 0 }] };
    if (maxTs) {
      r2 = await client.query(
        `SELECT COUNT(*)::int AS n
           FROM ${res.table}
          WHERE matrix_type = $1
            AND ts_ms = $2
            AND UPPER(base) = ANY($3)
            AND UPPER(quote)= ANY($3)`,
        [t, maxTs, U]
      );
    }
    res.rowsAtDbMaxTs[t] = r2.rows?.[0]?.n ?? 0;
  }

  // grab samples (top 5 per type) for human eyes
  const tops = {};
  for (const t of TYPES) {
    const r = await client.query(
      `SELECT base, quote, value
         FROM ${res.table}
        WHERE matrix_type = $1
          AND ts_ms = $2
          AND UPPER(base) = ANY($3)
          AND UPPER(quote)= ANY($3)
        ORDER BY base, quote
        LIMIT 5`,
      [t, tsByType[t], U]
    );
    tops[t] = r.rows || [];
  }
  res.tops = tops;

  await client.end();
  return res;
}

function cmpRows(headRows, dbRows) {
  const out = {};
  for (const t of TYPES) {
    out[t] = { head: headRows[t] || 0, db: dbRows[t] || 0, match: (headRows[t] || 0) === (dbRows[t] || 0) };
  }
  return out;
}

// ---- main -------------------------------------------------------------------
(async () => {
  console.log("── head-xray: settings → preview → pipeline → head/latest → DB ──");
  const coins = await getSettingsCoins();
  console.log("[coins]", coins.join(", "));

  // preview
  const pv = await jget(`/api/preview/binance${qsCoins(coins)}`);
  const pvCount = Array.isArray(pv?.body?.symbols) ? pv.body.symbols.length : 0;
  console.log("[preview]", pv.status, "symbols:", pvCount);

  // pipeline: start auto (immediate) and seed twice
  const started = await jpost("/api/pipeline/auto?immediate=1");
  console.log("[auto] start", started.status, started.body);

  const seed1 = await jpost("/api/pipeline/run-once");
  console.log("[seed#1]", seed1.status, seed1.body);

  await SLEEP(300);
  const seed2 = await jpost("/api/pipeline/run-once");
  console.log("[seed#2]", seed2.status, seed2.body);

  // head (with coins)
  const head = await jget(`/api/matrices/head${qsCoins(coins)}`);
  console.log("[head]", head.status, head.body);
  if (!head.ok) process.exit(2);

  // latest (with and without coins)
  const latestA = await jget(`/api/matrices/latest`);
  const latestB = await jget(`/api/matrices/latest${qsCoins(coins)}`);
  console.log("[latest] A(no coins)", latestA.status, "ts:", latestA.body?.ts);
  console.log("[latest] B(with coins)", latestB.status, "ts:", latestB.body?.ts);

  const apiTs = head.body?.ts || latestB.body?.ts || {};
  const headRows = head.body?.rows || { benchmark:0, delta:0, pct24h:0, id_pct:0, pct_drv:0 };

  // DB truth at API ts
  if (!DBURL) {
    console.log("⚠ DATABASE_URL not set; skipping DB probe.");
    const allZero = Object.values(headRows).every(n => !n);
    if (allZero) {
      console.log("❌ /api/matrices/head returned zero rows across types; verify head route counting and ?coins usage.");
      process.exit(1);
    }
    console.log("✅ Some head rows are non-zero; DB probe skipped.");
    process.exit(0);
  }

  const db = await dbProbe(apiTs, coins);
  console.log("[db]", JSON.stringify(db, null, 2));

  // compare head vs db (at the same api ts)
  const compare = cmpRows(headRows, db.rowsAtApiTs);
  console.log("[compare head vs db@apiTs]", compare);

  // verdicts & hints
  const anyMismatch = Object.values(compare).some(v => !v.match);
  const allZeroHead = Object.values(headRows).every(n => !n);
  const anyDbHas = Object.values(db.rowsAtApiTs).some(n => n > 0);

  console.log("────────────────────────────────────────────────────────");

  if (allZeroHead && anyDbHas) {
    console.error("❌ DB has rows at the same ts, but /api/matrices/head shows zeros.");
    console.error("   Hints:");
    console.error("   - Ensure head route uses the SAME table and ts (per type) and counts WITH coin filter.");
    console.error("   - Use UPPER(base/quote) in WHERE and pass UPPER(coins) array (your DB probe does).");
    console.error("   - If head uses getSnapshotByType, consider a countSnapshotByType that mirrors the SQL here.");
    process.exit(1);
  }

  if (anyMismatch) {
    console.error("❌ Head rows differ from DB counts.");
    console.error("   → Double-check coins source (settings.coinUniverse vs settings.coins),");
    console.error("     and that preview/binance is NOT used by head counting (head must read DB).");
    process.exit(1);
  }

  const zerosEverywhere = !anyDbHas;
  if (zerosEverywhere) {
    console.error("❌ DB also has zero rows at API ts.");
    console.error("   → Writer may persist at a different ts than head is using; confirm pipeline writer ts & table.");
    process.exit(1);
  }

  console.log("✅ Head counts match DB counts at API ts. Any remaining UI issues are likely client-side.");
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(2);
});
