// node src/scripts/smoke/doctor.mjs
// One-stop diagnostics for CryptoPi Dynamics matrices + pipeline + latest payload + preview rings
// - Uses only fetch; no extra deps. Designed for Windows/Node 22+.
// - Honors BASE_URL and COINS envs; otherwise queries /api/settings for coinUniverse.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const DEF_COINS = ["BTC","ETH","BNB","SOL","ADA","DOGE","USDT","PEPE","BRL"];

const nowMs = () => Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function ok(x){ return x && typeof x === "object"; }
function uniqUpper(list){
  const s = new Set(); const out=[];
  for (const t of list||[]) { const u=String(t||"").trim().toUpperCase(); if(u && !s.has(u)){ s.add(u); out.push(u); } }
  return out;
}
function pairs(coins){
  const out=[]; for (let i=0;i<coins.length;i++){ for(let j=0;j<coins.length;j++){ if(i===j) continue; out.push([coins[i],coins[j]]); } }
  return out;
}
function pad(n,w){ n=String(n); return n.length>=w?n:" ".repeat(w-n.length)+n; }
function pct(x){ return (x*100).toFixed(1)+"%"; }
function fmtTs(ms){ if(ms==null) return "∅"; const d=new Date(ms); return d.toISOString().replace("T"," ").replace("Z",""); }
function isFiniteN(x){ return typeof x==="number" && Number.isFinite(x); }

async function jreq(path, init){
  const r = await fetch(BASE + path, { cache: "no-store", ...init });
  let body=null; try { body = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, body, url: BASE+path };
}

async function getCoins(){
  if (process.env.COINS) return uniqUpper(process.env.COINS.split(","));
  const s = await jreq("/api/settings");
  const envCoins = process.env.NEXT_PUBLIC_COINS;
  if (ok(s.body) && Array.isArray(s.body.coinUniverse) && s.body.coinUniverse.length)
    return uniqUpper(s.body.coinUniverse);
  if (envCoins) return uniqUpper(envCoins.split(","));
  return DEF_COINS;
}

function calcCoverage(grid){
  let filled=0, total=0;
  for (let i=0;i<grid.length;i++){
    for (let j=0;j<grid.length;j++){
      if (i===j) continue;
      total++;
      const v = grid[i]?.[j];
      if (v!=null && Number.isFinite(v)) filled++;
    }
  }
  return { filled, total, cover: total ? (filled/total) : 0 };
}

function antisymmetryErrors(grid, tolAbs=1e-12, tolRel=1e-6){
  let bad=0, total=0;
  for (let i=0;i<grid.length;i++){
    for (let j=0;j<grid.length;j++){
      if (i===j) continue; total++;
      const a = grid[i]?.[j]; const b = grid[j]?.[i];
      if (a==null || b==null || !isFiniteN(a) || !isFiniteN(b)) continue;
      const tol = Math.max(tolAbs, tolRel*Math.max(Math.abs(a), Math.abs(b)));
      if (Math.abs(a + b) > tol) bad++;
    }
  }
  return { bad, total };
}

function bucketRings(previewFlags){
  // preview: 0 none, 1 direct, 2 inverse-only (as built by /api/matrices/latest builder)
  const n = previewFlags.length;
  let direct=0, inverseOnly=0, none=0;
  for (let i=0;i<n;i++){
    for (let j=0;j<n;j++){
      if (i===j) continue;
      const r = previewFlags[i]?.[j] ?? 0;
      if (r===1) direct++;
      else if (r===2) inverseOnly++;
      else none++;
    }
  }
  return { direct, inverseOnly, none };
}

function expectPreviewBuckets(coins, previewSymbols){
  const set = new Set(previewSymbols||[]);
  let direct=0, inverseOnly=0, none=0;
  for (const [A,B] of pairs(coins)){
    const d = set.has(A+B);
    const inv = set.has(B+A);
    if (d) direct++;
    else if (inv) inverseOnly++;
    else none++;
  }
  return { direct, inverseOnly, none };
}

async function getPreviewSymbols(coins){
  // prefer GET route
  let r = await jreq(`/api/preview/binance?coins=${encodeURIComponent(coins.join(","))}`);
  if (r.ok && r.body && Array.isArray(r.body.symbols)) return uniqUpper(r.body.symbols);
  // fallback to POST route shape
  r = await jreq("/api/preview/symbols", { method: "POST", headers: { "content-type":"application/json" }, body: JSON.stringify({ coins }) });
  if (r.ok && r.body && Array.isArray(r.body.symbols)) return uniqUpper(r.body.symbols);
  return [];
}

async function run() {
  console.log("── doctor: matrices + pipeline + latest ─────────────────────────");

  const coins = await getCoins();
  console.log("[coins]", coins.join(", "));

  // 1) Preview inventory
  const preview = await getPreviewSymbols(coins);
  console.log(`[preview] symbols: ${preview.length}`);

  // 2) Auto status; ensure running & immediate one-shot
  let auto = await jreq("/api/pipeline/auto");
  console.log("[auto] status", auto.status, auto.body);

  const start = await jreq("/api/pipeline/auto?immediate=1", { method: "POST" });
  console.log("[auto] start", start.status, start.body);

  // 3) Manual seed twice (so head.ts should advance)
  const seed1 = await jreq("/api/pipeline/run-once", { method: "POST" });
  console.log("[seed#1]", seed1.status, seed1.body);

  const head1 = await jreq("/api/matrices/head");
  console.log("[head#1]", head1.status, head1.body);

  await sleep(1200);

  const seed2 = await jreq("/api/pipeline/run-once", { method: "POST" });
  console.log("[seed#2]", seed2.status, seed2.body);

  const head2 = await jreq("/api/matrices/head");
  console.log("[head#2]", head2.status, head2.body);

  // 4) Check time advanced
  const moved = {};
  const keys = ["benchmark","delta","pct24h","id_pct","pct_drv"];
  for (const k of keys) {
    const a = Number(head1.body?.ts?.[k] ?? 0);
    const b = Number(head2.body?.ts?.[k] ?? 0);
    moved[k] = b > a;
  }
  console.log("[head advanced?]", moved);

  // 5) Hit latest payload to validate rings, flags, coverage, antisym
  const latest = await jreq(`/api/matrices/latest?coins=${encodeURIComponent(coins.join(","))}`);
  console.log("[latest] status", latest.status, "ts:", latest.body?.ts);

  const matrices = latest.body?.matrices || {};
  const flags = latest.body?.flags || {};
  const report = {};

  let allGood = true;

  for (const k of keys) {
    const grid = matrices[k];
    if (!Array.isArray(grid)) { report[k] = "∅"; allGood = false; continue; }
    const cov = calcCoverage(grid);
    const anti = (k==="benchmark") ? { bad: 0, total: 0 } : antisymmetryErrors(grid);
    report[k] = { coverage: pct(cov.cover), filled: `${cov.filled}/${cov.total}`, antisymBad: anti.bad };
    if (cov.cover < 0.75) allGood = false;
    if (k!=="benchmark" && anti.bad > 0) allGood = false;
  }

  // preview rings check
  if (Array.isArray(flags?.benchmark?.preview)) {
    const got = bucketRings(flags.benchmark.preview);
    const exp = expectPreviewBuckets(coins, preview);
    console.log("[rings] expected", exp, "got", got);
    // mismatch tolerance±2%:
    const totalPairs = pairs(coins).length;
    const diff = (a,b)=>Math.abs(a-b);
    const tol = Math.ceil(totalPairs*0.02);
    const ringsOk = diff(exp.direct, got.direct) <= tol && diff(exp.inverseOnly, got.inverseOnly) <= tol;
    if (!ringsOk) allGood = false;
  } else {
    console.log("[rings] preview flags missing in latest payload");
    allGood = false;
  }

  // frozen flags + bridged presence
  const frozenAny = Array.isArray(flags?.id_pct?.frozen)
    ? flags.id_pct.frozen.some(row => row?.some(Boolean))
    : false;
  const bridgedAny = Array.isArray(flags?.benchmark?.bridged)
    ? flags.benchmark.bridged.some(row => row?.some(Boolean))
    : false;

  console.log("────────────────────────────────────────────────────────");
  console.log("[coverage]", report);
  console.log("[frozen any]", frozenAny, "[bridged any]", bridgedAny);
  console.log("[moved?]", moved);
  console.log("────────────────────────────────────────────────────────");

  // 6) UI endpoints basic reachability (not full e2e)
  const pMat = await jreq("/matrices");
  const pDyn = await jreq("/dynamics");
  const pStr = await jreq("/str-aux");
  console.log("[ui] /matrices", pMat.status, "/dynamics", pDyn.status, "/str-aux", pStr.status);

  // 7) Verdict
  const headOK = Object.values(moved).some(Boolean); // at least one advanced since head#1
  const latestOK = latest.ok && latest.body && Object.values(report).every(v => v !== "∅");
  const uiOK = pStr.ok && pMat.ok; // dynamics is optional for now

  const verdict = (headOK && latestOK && uiOK && allGood) ? "✅ PASS" : "❌ FAIL";
  console.log(`[verdict] ${verdict}`);
  if (verdict !== "✅ PASS") {
    console.log("Hints:");
    if (!headOK) console.log(" - /api/matrices/head timestamps did not advance. Check pipeline writer + DB connection and table name.");
    if (!latestOK) console.log(" - /api/matrices/latest missing matrices. Confirm DB rows exist and table identifier (MATRIX_TABLE) matches.");
    if (!uiOK) console.log(" - UI endpoint returned non-200. Check hydration-safe counters and HomeBar DB health probe.");
    if (!allGood) console.log(" - Coverage/antisym/rings off. Verify preview selection + USDT bridge + antisym logic.");
    process.exitCode = 1;
  }
}

run().catch(e => { console.error("doctor crash:", e); process.exitCode = 1; });

