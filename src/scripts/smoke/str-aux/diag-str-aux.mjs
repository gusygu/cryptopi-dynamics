// node src/scripts/smoke/diag-str-combos.mjs
// Diagnostics for str-aux availability: coins -> all pair combos -> preview ∩ combos -> server.available

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const WINDOW = process.env.SMOKE_WINDOW || "30m";
const BINS = Number(process.env.SMOKE_BINS || 64) || 64;
const FAIL_MISS_RATIO = Number(process.env.SMOKE_FAIL_MISS_RATIO || 0.15); // fail if >15% missing

async function jget(p, init) {
  const url = `${BASE}${p}`;
  const res = await fetch(url, init);
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    return { url, status: res.status, json };
  } catch {
    throw new Error(`Non-JSON from ${url}: ${text.slice(0, 200)}…`);
  }
}
function uniq(arr) { return Array.from(new Set(arr)); }
function up(arr) { return uniq((arr || []).map(s => String(s).toUpperCase().trim()).filter(Boolean)); }
function cartesianPairs(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let j = 0; j < tokens.length; j++) {
      if (i === j) continue;
      out.push(tokens[i] + tokens[j]);
    }
  }
  return uniq(out);
}
function sample(arr, n = 8) { return (arr || []).slice(0, n); }
function arrDiff(a, b) {
  const A = new Set(a || []), B = new Set(b || []);
  const onlyA = []; for (const x of A) if (!B.has(x)) onlyA.push(x);
  return onlyA;
}
function bucketByQuote(symbols, coinsSet) {
  const USDT = [], XCR = [], EXT = [];
  for (const s of symbols || []) {
    if (s.endsWith("USDT")) USDT.push(s);
    else {
      // check if any coin token is a suffix → cross-crypto
      let isCross = false;
      for (const c of coinsSet) {
        if (c === "USDT") continue;
        if (s.endsWith(c)) { isCross = true; break; }
      }
      if (isCross) XCR.push(s); else EXT.push(s);
    }
  }
  return { USDT, XCR, EXT };
}

(async () => {
  // 1) Coin universe (prefer server settings)
  const set = await jget("/api/settings");
  let coins = up(set.json?.coinUniverse || (process.env.SMOKE_COINS || "BTC,ETH,USDT").split(","));
  if (coins.length < 2) coins = up(["BTC", "ETH", "USDT"]);
  const coinsSet = new Set(coins);

  // 2) All pair combos (ordered, base≠quote)
  const allPairs = cartesianPairs(coins);

  // 3) Preview symbols (try GET then POST)
  let previewSyms = [];
  try {
    const r1 = await jget(`/api/preview/binance?coins=${encodeURIComponent(coins.join(","))}`);
    if (r1.status === 200 && r1.json?.symbols) previewSyms = up(r1.json.symbols);
  } catch (_) {}
  if (!previewSyms.length) {
    try {
      const r2 = await jget(`/api/preview/symbols`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coins }),
      });
      if (r2.status === 200 && r2.json?.symbols) previewSyms = up(r2.json.symbols);
    } catch (_) {}
  }

  // 4) Expected-by-preview: combos ∩ preview
  const expected = uniq(allPairs.filter(s => previewSyms.includes(s)));

  // 5) Server route (coins=… path) — single shot
  const qs = `coins=${coins.join(",")}&window=${WINDOW}&bins=${BINS}&sessionId=diag-combos`;
  const { json: route } = await jget(`/api/str-aux/bins?${qs}`);
  if (!route || route.ok === false) {
    console.error("[diag] route not ok:", route);
    process.exit(2);
  }

  const serverAvail = up(route?.available?.all || []);
  const serverUsdt  = up(route?.available?.usdt || []);
  const serverSelected = up(route?.selected || []);
  const serverSymbols  = up(route?.symbols || []);
  const coinsInfo = coins.join(",");

  // 6) Coverage analysis
  const missing = arrDiff(expected, serverAvail);         // should be empty ideally
  const extra   = arrDiff(serverAvail, expected);         // ok if preview routes are stricter than route
  const missRatio = expected.length ? (missing.length / expected.length) : 0;

  // 7) Buckets (for readability)
  const bPreview = bucketByQuote(expected, coinsSet);
  const bServer  = bucketByQuote(serverAvail, coinsSet);

  // 8) Print an interpretable index
  console.log("────────────────────────────────────────────────────────");
  console.log(`[diag] coins: ${coinsInfo}`);
  console.log(`[diag] allPairs: ${allPairs.length}`);
  console.log(`[diag] preview:  ${previewSyms.length} symbols`);
  console.log(`[diag] expected (combos∩preview): ${expected.length}`);
  console.log(`[diag] server.available.all:      ${serverAvail.length}`);
  console.log(`[diag] server.available.usdt:     ${serverUsdt.length}`);
  console.log(`[diag] server.selected:           ${serverSelected.length}`);
  console.log(`[diag] server.symbols (processed):${serverSymbols.length}`);
  console.log("────────────────────────────────────────────────────────");
  console.log("[diag] expected buckets:", {
    USDT: bPreview.USDT.length,
    XCR:  bPreview.XCR.length,
    EXT:  bPreview.EXT.length,
  });
  console.log("[diag] server   buckets:", {
    USDT: bServer.USDT.length,
    XCR:  bServer.XCR.length,
    EXT:  bServer.EXT.length,
  });
  console.log("────────────────────────────────────────────────────────");
  if (missing.length) {
    console.log("[diag] missing on server (expected but not in available):",
      missing.length, "→", sample(missing));
  }
  if (extra.length) {
    console.log("[diag] extra on server (in available but not expected):",
      extra.length, "→", sample(extra));
  }

  // 9) Spot-check server.out integrity for a few symbols
  const out = route?.out || {};
  const bad = [];
  for (const s of sample(serverAvail, 12)) {
    const row = out[s];
    if (!row || row.ok === false) bad.push(s);
  }
  if (bad.length) {
    console.log("[diag] server returned bad/no data for:", bad.length, "→", bad);
  }

  // 10) Decide pass/fail
  if (missRatio > FAIL_MISS_RATIO) {
    console.error(`❌ FAIL: missing ratio ${(missRatio*100).toFixed(1)}% > ${(FAIL_MISS_RATIO*100)}%`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: coverage ${(100 - missRatio*100).toFixed(1)}% (missing ${missing.length}/${expected.length})`);
    process.exit(0);
  }
})();
