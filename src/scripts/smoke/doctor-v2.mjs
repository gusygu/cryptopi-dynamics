/* eslint-disable no-console */
const BASE = process.env.BASE_URL || 'http://localhost:3000';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function jget(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers || {}), 'accept': 'application/json' } });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  return { status: res.status, ok: res.ok, json, text };
}
async function jpost(path, body) {
  return jget(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function uniq(arr) {
  const out = []; const seen = new Set();
  for (const x of arr || []) { const u = String(x || '').trim().toUpperCase(); if (u && !seen.has(u)) { seen.add(u); out.push(u); } }
  return out;
}

function allPairs(coins) {
  const out = [];
  for (let i = 0; i < coins.length; i++) {
    for (let j = 0; j < coins.length; j++) {
      if (i === j) continue;
      out.push([coins[i], coins[j]]);
    }
  }
  return out;
}

function classifyRings(coins, previewSymbols) {
  const up = new Set((previewSymbols || []).map(s => String(s || '').toUpperCase()));
  let direct = 0, inverseOnly = 0, none = 0;
  for (const [a, b] of allPairs(coins)) {
    const d = up.has(`${a}${b}`);
    const inv = up.has(`${b}${a}`);
    if (d) direct++;
    else if (inv) inverseOnly++;
    else none++;
  }
  return { direct, inverseOnly, none };
}

function coverageOf(mat, coins) {
  const N = coins.length; let filled = 0; let badAnti = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const v = mat?.[i]?.[j];
      if (Number.isFinite(v)) filled++;
      const opp = mat?.[j]?.[i];
      if (Number.isFinite(v) && Number.isFinite(opp)) {
        // antisymmetry check: v ~= -opp (allow tiny epsilon)
        if (Math.abs(v + opp) > 1e-9) badAnti++;
      }
    }
  }
  const total = N * (N - 1);
  const pct = total ? ((filled / total) * 100).toFixed(1) : '0.0';
  return { filled: `${filled}/${total}`, coverage: `${pct}%`, antisymBad: badAnti };
}

function moved(ts1, ts2) {
  const out = {};
  for (const k of Object.keys(ts1 || {})) out[k] = (Number(ts2?.[k]) || 0) > (Number(ts1?.[k]) || 0);
  return out;
}

function anyFrozen(mats1, mats2, coins) {
  const N = coins.length;
  let frozen = false;
  for (const key of Object.keys(mats1)) {
    const A = mats1[key], B = mats2[key];
    if (!A || !B) continue;
    outer: for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const a = A?.[i]?.[j], b = B?.[i]?.[j];
        if (Number.isFinite(a) && Number.isFinite(b) && a === b) { frozen = true; break outer; }
      }
    }
  }
  return frozen;
}

function bridgePossibleCount(coins, previewSymbols) {
  const up = new Set((previewSymbols || []).map(s => String(s || '').toUpperCase()));
  let cnt = 0;
  for (const [a, b] of allPairs(coins)) {
    if (a === b) continue;
    // USDT bridge exists if a/USDT and b/USDT exist somehow
    const aU = up.has(`${a}USDT`) || up.has(`USDT${a}`);
    const bU = up.has(`${b}USDT`) || up.has(`USDT${b}`);
    if (!up.has(`${a}${b}`) && !up.has(`${b}${a}`) && aU && bU) cnt++;
  }
  return cnt;
}

async function uiProbe(path) {
  const r = await fetch(`${BASE}${path}`, { method: 'GET' });
  return { path, ok: r.ok, status: r.status };
}

async function main() {
  console.log('── doctor: matrices + pipeline + latest (v2) ─────────────────────────');

  // SETTINGS
  const s = await jget('/api/settings');
  const coins = uniq(s?.json?.coinUniverse || s?.json?.settings?.coinUniverse || ['BTC','ETH','BNB','SOL','ADA','XRP','PEPE','USDT']);
  console.log('[coins]', coins.join(', '));

  // PREVIEW (try GET then POST fallback)
  let previewSymbols = [];
  {
    const q = encodeURIComponent(coins.join(','));
    const g = await jget(`/api/preview/binance?coins=${q}`);
    if (g.ok && Array.isArray(g?.json?.symbols)) previewSymbols = g.json.symbols;
    if (previewSymbols.length === 0) {
      const p = await jpost('/api/preview/symbols', { coins });
      if (p.ok) {
        if (Array.isArray(p?.json?.symbols)) previewSymbols = p.json.symbols;
        else if (Array.isArray(p?.json)) previewSymbols = p.json;
      }
    }
  }
  console.log('[preview] symbols:', previewSymbols.length);

  // PIPELINE AUTO
  const auto0 = await jget('/api/pipeline/auto');
  console.log('[auto] status', auto0.status, auto0.json);
  if (!auto0.json?.running) {
    const started = await jpost('/api/pipeline/auto?immediate=1');
    console.log('[auto] start', started.status, started.json);
  }

  // SEED #1
  const seed1 = await jpost('/api/pipeline/run-once');
  console.log('[seed#1]', seed1.status, seed1.json);

  // HEAD #1
  const head1 = await jget('/api/matrices/head');
  console.log('[head#1]', head1.status, head1.json);

  // SEED #2 (short delay to avoid writing the same ms)
  await sleep(300);
  const seed2 = await jpost('/api/pipeline/run-once');
  console.log('[seed#2]', seed2.status, seed2.json);

  // HEAD #2
  const head2 = await jget('/api/matrices/head');
  console.log('[head#2]', head2.status, head2.json);

  // HEAD movement
  const headMoved = moved(head1?.json?.ts || {}, head2?.json?.ts || {});
  console.log('[head advanced?]', headMoved);

  // LATEST twice (movement/freeze & coverage)
  const qCoins = encodeURIComponent(coins.join(','));
  const latest1 = await jget(`/api/matrices/latest?coins=${qCoins}`);
  const mats1 = latest1?.json?.matrices || {};
  const ts1 = latest1?.json?.ts || {};
  console.log('[latest] status', latest1.status, 'ts:', ts1);

  await sleep(300);
  const latest2 = await jget(`/api/matrices/latest?coins=${qCoins}`);
  const mats2 = latest2?.json?.matrices || {};
  const ts2 = latest2?.json?.ts || {};

  const cov = {
    benchmark: coverageOf(mats1.benchmark, coins),
    delta:     coverageOf(mats1.delta,     coins),
    pct24h:    coverageOf(mats1.pct24h,    coins),
    id_pct:    coverageOf(mats1.id_pct,    coins),
    pct_drv:   coverageOf(mats1.pct_drv,   coins),
  };
  console.log('────────────────────────────────────────────────────────');
  console.log('[coverage]', cov);

  // Rings expectation vs preview
  const ringsExpected = classifyRings(coins, previewSymbols);
  const ringsBridgePossible = bridgePossibleCount(coins, previewSymbols);
  console.log('[rings] expected', ringsExpected, 'bridgePossible', ringsBridgePossible);

  // Movement & frozen
  const adv = moved(ts1, ts2);
  const frozenAny = anyFrozen(mats1, mats2, coins);
  console.log('[moved?]', adv, 'frozenAny:', frozenAny);

  // UI endpoints (just status)
  const ui = await Promise.all(['/matrices','/dynamics','/str-aux'].map(p => uiProbe(p)));
  console.log('────────────────────────────────────────────────────────');
  console.log('[ui]', ...ui.map(x => `${x.path} ${x.status}`).join(' '));

  // Verdict & Hints
  let ok = true;
  const hints = [];

  // If preview empty we’ll never be able to mark rings properly
  if (previewSymbols.length === 0) {
    ok = false;
    hints.push('Preview returned 0 symbols. Verify /api/preview/binance and /api/preview/symbols wiring and upstream Binance client.');
  }

  // Head should reflect DB writer activity
  const headRows1 = head1?.json?.rows || {};
  const headRows2 = head2?.json?.rows || {};
  const rowsZero = Object.values(headRows1).every(v => Number(v || 0) === 0) && Object.values(headRows2).every(v => Number(v || 0) === 0);
  if (rowsZero) {
    ok = false;
    hints.push('HEAD rows are 0. Check that your pipeline actually persists matrices to the DB and that /api/matrices/head is reading the same table/namespace.');
  }
  const headAnyAdvanced = Object.values(headMoved).some(Boolean);
  if (!headAnyAdvanced) {
    ok = false;
    hints.push('HEAD timestamps did not advance between two seeds. Verify writer function + DB connection + table names.');
  }

  // Derived coverage sanity (id_pct / pct_drv often half-size if only one triangle is calculated)
  const idBad = Number(cov.id_pct.antisymBad || 0);
  const drvBad = Number(cov.pct_drv.antisymBad || 0);
  if (idBad > 0 || drvBad > 0) {
    hints.push('Antisymmetry mismatches in id_pct/pct_drv. Ensure inverse filling and derivation run AFTER base triangle populate (or expand bridge/inverse completion).');
  }

  // Frozen matrix cells or no timestamp movement
  const tsAdvAny = Object.values(adv).some(Boolean);
  if (!tsAdvAny || frozenAny) {
    hints.push('Latest matrices look frozen. Check universal poller coupling to latest route & ensure timestamps come from live Binance/compute, not a stub.');
  }

  // Friendly WARN for wallet cache (can mask perceived stalls if you watch too quickly)
  hints.push('Note: account adapter caches 40s; frequent refreshes may look stale if you watch sub-40s windows.');

  console.log('[verdict]', ok ? '✅ PASS' : '❌ FAIL');
  if (hints.length) {
    console.log('Hints:'); for (const h of hints) console.log(' -', h);
  }

  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
