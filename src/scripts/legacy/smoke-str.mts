#!/usr/bin/env node
/* eslint-disable */
/*
Run:
pnpm tsx -r dotenv/config -r tsconfig-paths/register src/scripts/smoke-str.mts
Add --live to fetch Binance klines:
pnpm tsx -r dotenv/config -r tsconfig-paths/register src/scripts/smoke-str.mts --live BTCUSDT 1m 60
*/

type Check = { name: string; ok: boolean; warn?: boolean; msg?: string };
const okTag = (c: Check) => (c.ok ? (c.warn ? '⚠️' : '✅') : '❌');

function print(checks: Check[]) {
  for (const c of checks) console.log(`${okTag(c)} ${c.name}${c.msg ? ' - ' + c.msg : ''}`);
  console.log(checks.every(c => c.ok) ? 'SMOKE: PASS' : 'SMOKE: FAIL');
}

const num = (x: any, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);

async function fetchKlines(symbol = 'BTCUSDT', interval = '1m', limit = 60) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`klines HTTP ${r.status}`);
  const rows = await r.json();
  return rows.map((c: any[]) => ({ ts: c[0], price: Number(c[4]), volume: Number(c[5]) }));
}

(async () => {
  const checks: Check[] = [];
  const live = process.argv.includes('--live');
  const args = process.argv.slice(process.argv.indexOf('--live') + 1);
  const [sym = 'BTCUSDT', interval = '1m', limStr = '60'] = live ? args : [];
  const limit = Number(limStr) || 60;

  // imports from your lab
  const { computeFloatingModeIDHR } = await import('@/lab/str-aux/idhr');

  // points
  let points: Array<{ ts: number; price: number; volume: number }>;
  if (live) {
    try {
      points = await fetchKlines(sym, interval, limit);
      checks.push({ name: 'binance klines fetch', ok: points.length > 0, msg: `${sym} ${interval} n=${points.length}` });
    } catch (e: any) {
      print([{ name: 'binance klines fetch', ok: false, msg: e?.message ?? String(e) }]);
      return;
    }
  } else {
    // synthetic drift for offline smoke
    const now = Date.now();
    const prices = [100, 100.5, 99.8, 101.2, 102.1, 101.7];
    const volumes = [5, 7, 6, 8, 7, 6];
    points = prices.map((p, i) => ({ ts: now - (prices.length - i) * 10_000, price: p, volume: volumes[i] }));
  }

  const opening = {
    benchmark: num(points[0]?.price, 0),
    pct24h: 0,
    id_pct: 0,
    ts: points[0]?.ts ?? Date.now(),
    layoutHash: 'smoke',
  };

  try {
    const fm = computeFloatingModeIDHR(points as any, opening as any, { innerBins: 5, outerBins: 4, alpha: 1.0, sMin: 1e-6, topN: 3 });

    checks.push({ name: 'bins',      ok: true, msg: 'computed via IDHR' });
    checks.push({ name: 'gfm',       ok: Number.isFinite(fm.gfm),       msg: String(fm.gfm) });
    checks.push({ name: 'sigma',     ok: Number.isFinite(fm.sigmaGlobal), msg: String(fm.sigmaGlobal) });
    checks.push({ name: '|z| mean',  ok: Number.isFinite(fm.zMeanAbs),  msg: String(fm.zMeanAbs) });
    checks.push({ name: 'vInner',    ok: Number.isFinite(fm.vInner),    msg: String(fm.vInner) });
    checks.push({ name: 'vOuter',    ok: Number.isFinite(fm.vOuter),    msg: String(fm.vOuter) });
    checks.push({ name: 'inertia',   ok: Number.isFinite(fm.inertia),   msg: String(fm.inertia) });
    checks.push({ name: 'disruption',ok: Number.isFinite(fm.disruption),msg: String(fm.disruption) });
    checks.push({ name: 'nuclei',    ok: Array.isArray(fm.nuclei),      msg: `k=${fm.nuclei.length}` });
  } catch (e: any) {
    checks.push({ name: 'floating mode', ok: false, msg: e?.message ?? String(e) });
  }

  print(checks);
})();
