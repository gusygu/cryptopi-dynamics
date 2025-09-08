#!/usr/bin/env node
/* eslint-disable */

// Run:
// pnpm tsx -r dotenv/config -r tsconfig-paths/register src/scripts/smoke-idhr.mts
// Live (BTC 1m, 90 candles):
// pnpm tsx -r dotenv/config -r tsconfig-paths/register src/scripts/smoke-idhr.mts --live BTCUSDT 1m 90

type Check = { name: string; ok: boolean; warn?: boolean; msg?: string };
const tag = (c: Check) => (c.ok ? (c.warn ? "⚠️" : "✅") : "❌");
const print = (cs: Check[]) => {
  for (const c of cs) console.log(`${tag(c)} ${c.name}${c.msg ? " - " + c.msg : ""}`);
  console.log(cs.every(c => c.ok) ? "SMOKE: PASS" : "SMOKE: FAIL");
};

async function tryImportIdhr() {
  // Try alias first (works if tsconfig-paths is honored), then relative to this file.
  const candidates = [
    "@/lab/str-aux/idhr",
    "../lab/str-aux/idhr.ts",
    "../lab/str-aux/idhr", // tsx often resolves .ts implicitly
  ];
  for (const spec of candidates) {
    try {
      const m = await import(spec);
      return { mod: m, from: spec };
    } catch {}
  }
  throw new Error("Could not import idhr module from any known path");
}

async function fetchKlines(symbol = "BTCUSDT", interval = "1m", limit = 90) {
  const base = process.env.BINANCE_BASE_URL ?? "https://api.binance.com";
  const url = `${base}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`klines HTTP ${r.status}`);
  const rows = (await r.json()) as any[];
  return rows.map(c => ({ ts: Number(c[0]), price: Number(c[4]), volume: Number(c[5]) }));
}

(async () => {
  const checks: Check[] = [];
  let mod: any, from: string;

  try {
    ({ mod, from } = await tryImportIdhr());
    checks.push({ name: "import idhr.ts", ok: true, msg: from });
  } catch (e: any) {
    print([{ name: "import idhr.ts", ok: false, msg: e?.message ?? String(e) }]);
    return;
  }

  // Pull functions if present
  const computeIdhrBinsN = mod.computeIdhrBinsN as
    | ((pts: any[], opening: any, cfg?: any, N?: number) => any)
    | undefined;

  const computeIdhrBins = mod.computeIdhrBins as
    | ((pts: any[], opening: any, cfg?: any) => any)
    | undefined;

  const computeFloatingModeIDHR = mod.computeFloatingModeIDHR as
    | ((pts: any[], opening: any, cfg?: any) => any)
    | undefined;

  const extractNuclei = mod.extractNuclei as
    | ((bins: any, k: number) => any[])
    | undefined;

  // Build dataset (live or synthetic)
  const live = process.argv.includes("--live");
  const args = process.argv.slice(process.argv.indexOf("--live") + 1);
  const [sym = "BTCUSDT", intv = "1m", limStr = "90"] = live ? args : [];
  const lim = Number(limStr) || 90;

  let pts: Array<{ ts: number; price: number; volume: number }>;
  if (live) {
    try {
      pts = await fetchKlines(sym, intv, lim);
      checks.push({ name: "klines fetch", ok: pts.length > 0, msg: `${sym} ${intv} n=${pts.length}` });
    } catch (e: any) {
      print([{ name: "klines fetch", ok: false, msg: e?.message ?? String(e) }]);
      return;
    }
  } else {
    const now = Date.now();
    const prices = [100, 100.5, 99.8, 101.2, 102.1, 101.7, 102.3, 101.9, 102.7, 102.0];
    const vols =    [5,   7,    6,    8,    7,    6,    9,    8,    7,    6   ];
    pts = prices.map((p, i) => ({ ts: now - (prices.length - i) * 10_000, price: p, volume: vols[i] }));
  }

  const opening = {
    benchmark: pts[0]?.price ?? 0,
    pct24h: 0,
    id_pct: 0,
    ts: pts[0]?.ts ?? Date.now(),
    layoutHash: "smoke-idhr",
  };

  try {
    // Histogram with 128 bins
    const hist =
      computeIdhrBinsN?.(pts, opening, { topN: 3 }, 128) ??
      computeIdhrBins?.(pts, opening, { topN: 3, totalBins: 128 });

    checks.push({
      name: "hist present",
      ok: !!hist && Array.isArray(hist.edges) && Array.isArray(hist.counts),
      msg: hist ? `bins=${hist.edges?.length ?? "?"}` : "null",
    });

    if (!hist) throw new Error("No histogram produced (computeIdhrBinsN/computeIdhrBins missing)");

    checks.push({
      name: "hist length 128",
      ok: (hist.edges?.length ?? 0) === 128,
      msg: `bins=${hist.edges?.length ?? "?"}`,
    });

    checks.push({
      name: "sigma > 0",
      ok: Number(hist.sigmaGlobal) > 0,
      msg: String(hist.sigmaGlobal),
    });

    // Floating Mode: prefer provided fn; otherwise compute from histogram
    let fm = null as any;
    if (computeFloatingModeIDHR) {
      fm = computeFloatingModeIDHR(pts, opening, { totalBins: 128, topN: 3 });
      checks.push({ name: "FM via export", ok: true });
    } else {
      // fallback FM using the histogram
      const counts: number[] = hist.counts ?? [];
      const edges: number[] = hist.edges ?? [];
      let best = -Infinity;
      let modeIdx = 0;
      for (let i = 0; i < counts.length; i++) if (counts[i] > best) { best = counts[i]; modeIdx = i; }
      const gfm = edges[modeIdx] ?? 0;

      const muR = hist.muR ?? 0;
      const sigma = hist.sigmaGlobal || 1e-12;
      const rets = pts.map(p => Math.log((p.price ?? 0) / (opening.benchmark || 1))).filter(v => Number.isFinite(v));
      const zAbs = rets.length ? rets.reduce((a, r) => a + Math.abs((r - muR) / sigma), 0) / rets.length : 0;

      const left = counts.slice(0, modeIdx).reduce((a, b) => a + b, 0);
      const right = counts.slice(modeIdx + 1).reduce((a, b) => a + b, 0);
      const vInner = Math.max(0, Math.min(left, right));
      const vOuter = Math.max(0, left + right - vInner);

      let nuclei: any[] | undefined = undefined;
      if (extractNuclei) try { nuclei = extractNuclei(hist, 3); } catch {}

      fm = { gfm, zMeanAbs: zAbs, sigmaGlobal: sigma, vInner, vOuter, nuclei };
      checks.push({ name: "FM via fallback", ok: true });
    }

    checks.push({ name: "gfm finite", ok: Number.isFinite(fm.gfm), msg: String(fm.gfm) });
    checks.push({ name: "|z| finite", ok: Number.isFinite(fm.zMeanAbs), msg: String(fm.zMeanAbs) });

    if (fm.nuclei) {
      checks.push({ name: "nuclei >= 1", ok: (fm.nuclei?.length ?? 0) >= 1, msg: `k=${fm.nuclei?.length ?? 0}` });
    } else {
      checks.push({ name: "nuclei check", ok: true, warn: true, msg: "extractNuclei not exported (skipped)" });
    }
  } catch (e: any) {
    checks.push({ name: "compute", ok: false, msg: e?.message ?? String(e) });
  }

  print(checks);
})();
