// src/scripts/smoke/doctor-v4.mjs
/* eslint-disable no-console */
const BASE = process.env.BASE_URL || "http://localhost:3000";
const COINS_ENV = process.env.COINS ? process.env.COINS.split(",").map(s=>s.trim().toUpperCase()).filter(Boolean) : null;

async function jget(path, init) {
  const r = await fetch(`${BASE}${path}`, init);
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch {}
  return { status: r.status, ok: r.ok, json: j, text: t };
}

function countCells(m) {
  if (!m) return 0;
  if (Array.isArray(m)) {
    let n = 0;
    for (const row of m) {
      if (Array.isArray(row)) { for (const v of row) if (v != null) n++; }
      else if (row && typeof row === "object" && "value" in row) {
        if (row.value != null) n++;
      }
    }
    return n;
  }
  if (typeof m === "object") {
    let n = 0;
    for (const row of Object.values(m)) {
      if (row && typeof row === "object") {
        for (const v of Object.values(row)) if (v != null) n++;
      }
    }
    return n;
  }
  return 0;
}

function pickCoins(settingsCoins) {
  if (COINS_ENV?.length) return Array.from(new Set(COINS_ENV));
  if (Array.isArray(settingsCoins) && settingsCoins.length) {
    return Array.from(new Set(settingsCoins.map(s => String(s).toUpperCase())));
  }
  return ["BTC","ETH","BNB","SOL","ADA","XRP","PEPE","USDT"];
}

async function maybeDbCheck(ts) {
  if (!process.env.DATABASE_URL) return { note: "DATABASE_URL not set — DB check skipped" };
  try {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const types = ["benchmark","delta","pct24h","id_pct","pct_drv"];
    const out = {};
    for (const t of types) {
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS n FROM dyn_matrix_values WHERE ts_ms = $1 AND matrix_type = $2`,
        [Number(ts[t]), t]
      );
      out[t] = rows?.[0]?.n ?? 0;
    }
    await client.end();
    return { ok: true, rowsAtLatestTs: out };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

(async function main() {
  console.log("── doctor: matrices + pipeline + latest (v4) ─────────────────────────");

  // Settings
  const settings = await jget("/api/settings");
  const coins = pickCoins(settings.json?.coins);
  console.log("[settings coins]", settings.status, coins.join(", "));

  // Preview diagnostics
  const preview = await jget(`/api/preview/binance?coins=${encodeURIComponent(coins.join(","))}`);
  console.log("[preview] status", preview.status, "symbols:", Array.isArray(preview.json?.symbols) ? preview.json.symbols.length : "n/a");

  // Start auto (idempotent)
  const autoStart = await jget("/api/pipeline/auto?immediate=1", { method: "POST" });
  console.log("[auto] start", autoStart.status, autoStart.json);

  // Seed twice
  const seed1 = await jget("/api/pipeline/run-once", { method: "POST" });
  const seed2 = await jget("/api/pipeline/run-once", { method: "POST" });
  console.log("[seed#1]", seed1.status, seed1.json);
  console.log("[seed#2]", seed2.status, seed2.json);

  // HEAD
  const head = await jget(`/api/matrices/head?coins=${encodeURIComponent(coins.join(","))}`);
  console.log("[head]", head.status, head.json);

  // LATEST
  const latest = await jget(`/api/matrices/latest?coins=${encodeURIComponent(coins.join(","))}`);
  const ts = latest.json?.ts ?? {};
  const rowsFromLatest = {
    benchmark: countCells(latest.json?.benchmark),
    delta:     countCells(latest.json?.delta),
    pct24h:    countCells(latest.json?.pct24h),
    id_pct:    countCells(latest.json?.id_pct),
    pct_drv:   countCells(latest.json?.pct_drv),
  };
  console.log("[latest] status", latest.status, "ts:", ts);
  console.log("[rowsFromLatest]", rowsFromLatest);

  // Compare head.rows vs rowsFromLatest
  const cmp = {};
  for (const k of Object.keys(rowsFromLatest)) {
    const hv = Number(head.json?.rows?.[k] ?? 0);
    const lv = Number(rowsFromLatest[k]);
    cmp[k] = { head: hv, latest: lv, match: hv === lv };
  }
  console.log("[compare head vs latest]", cmp);

  // Optional DB check at latest ts
  const dbProbe = await maybeDbCheck(ts);
  console.log("[db probe]", dbProbe);

  // Verdict
  const headAny = Object.values(head.json?.rows ?? {}).some((n) => Number(n) > 0);
  const latestAny = Object.values(rowsFromLatest).some((n) => Number(n) > 0);
  const verdict = headAny && latestAny ? "PASS" : "FAIL";
  console.log("────────────────────────────────────────────────────────");
  console.log("[verdict]", verdict);
  if (!headAny) {
    console.log("Hint: HEAD counting may be mismatched to /latest payload shape. This script used a robust counter; if 'rowsFromLatest' > 0 but head.rows == 0, update head route counter (object-of-objects).");
  }
  if (!latestAny) {
    console.log("Hint: /latest payload is empty; check pipeline writer and upstream fetch/compute.");
  }
  process.exit(verdict === "PASS" ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
