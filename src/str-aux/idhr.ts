// src/lab/str-aux/idhr.ts
// Deterministic IDHR histogram (with exact bin control) + Floating Mode metrics.
// - Each function merges config locally into `C` (fixes “C is not defined”).
// - `totalBins` enables exact-bin sizing (e.g., 128).
// - Returns Floating Mode (gfm) + basic shape stats.
// - Nuclei now match your repo’s Nucleus type: { binIndex, density, firstDegree, secondDegree }.

import type {
  MarketPoint,
  OpeningExact,
  Nucleus,
  IdhrResult,
} from '@/str-aux/types';

// ---------- Config & Types ----------

export type IdhrConfig = {
  innerBins: number;  // bins near 0
  outerBins: number;  // bins per tail
  alpha: number;      // span multiplier around mean (μ ± α·σ)
  sMin: number;       // sigma floor to avoid collapse
  topN: number;       // number of nuclei to keep
  totalBins?: number; // optional: force final bin count (e.g., 128)
};

export const DEFAULT_IDHR: IdhrConfig = {
  innerBins: 5,
  outerBins: 4,
  alpha: 2.5,
  sMin: 1e-6,
  topN: 3,
};

export type IdhrBins = {
  edges: number[];    // length = bins
  counts: number[];   // length = bins
  probs: number[];    // length = bins
  muR: number;
  stdR: number;
  sigmaGlobal: number; // alias to stdR
};

// ---------- Utils ----------

function clamp(n: number, lo: number, hi: number) {
  return n < lo ? lo : n > hi ? hi : n;
}
function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function stdev(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(Math.max(0, v));
}
function linspace(min: number, max: number, n: number) {
  if (n <= 1) return [min];
  const step = (max - min) / (n - 1);
  return Array.from({ length: n }, (_, i) => min + i * step);
}
function argMax(xs: number[]) {
  let idx = 0, best = -Infinity;
  for (let i = 0; i < xs.length; i++) if (xs[i] > best) { best = xs[i]; idx = i; }
  return idx;
}
function smooth1d(xs: number[], k = 3) {
  const n = xs.length;
  if (n === 0 || k <= 1) return xs.slice();
  const half = Math.floor(k / 2);
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = i - half; j <= i + half; j++) if (j >= 0 && j < n) { s += xs[j]; c++; }
    out[i] = s / (c || 1);
  }
  return out;
}

// ---------- Core: computeIdhrBins ----------

export function computeIdhrBins(
  points: MarketPoint[],
  opening: OpeningExact,
  cfg: Partial<IdhrConfig> = {},
): IdhrBins {
  // local config (fixes “C is not defined”)
  const C: IdhrConfig = { ...DEFAULT_IDHR, ...cfg };

  // returns as log(px / p0)
  const p0 = Number(opening?.benchmark ?? 0);
  const returns: number[] = [];
  for (const p of points) {
    const px = Number(p?.price ?? 0);
    if (Number.isFinite(px) && px > 0 && Number.isFinite(p0) && p0 > 0) {
      returns.push(Math.log(px / p0));
    }
  }

  // robust stats
  const mu0 = mean(returns);
  const sd0 = Math.max(stdev(returns), C.sMin);

  // range and bins
  const span = C.alpha * sd0;
  const rMin = mu0 - span;
  const rMax = mu0 + span;

  const binsFromParts = C.innerBins + 2 * C.outerBins + 1;
  const bins = Math.max(8, Math.floor(C.totalBins ?? binsFromParts));

  const edges = linspace(rMin, rMax, bins);

  // counts (nearest-edge)
  const counts = new Array(bins).fill(0);
  const step = bins > 1 ? (rMax - rMin) / (bins - 1) : 1;
  if (step > 0) {
    for (const r of returns) {
      const ii = clamp(Math.round((r - rMin) / step), 0, bins - 1);
      counts[ii] += 1;
    }
  }

  const total = counts.reduce((a, b) => a + b, 0);
  const probs = counts.map(c => (total > 0 ? c / total : 0));

  const inWin: number[] = [];
  for (const r of returns) if (r >= rMin && r <= rMax) inWin.push(r);
  const muR = mean(inWin);
  const stdR = Math.max(stdev(inWin), C.sMin);

  return { edges, counts, probs, muR, stdR, sigmaGlobal: stdR };
}

// ---------- Nuclei (peak extraction) ----------

export function extractNuclei(bins: IdhrBins, k: number): Nucleus[] {
  const sm = smooth1d(bins.counts, 5);
  const n = sm.length;

  // central differences for 1st/2nd derivatives
  const first: number[] = new Array(n).fill(0);
  const second: number[] = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    first[i] = (sm[i + 1] - sm[i - 1]) / 2;
    second[i] = sm[i + 1] - 2 * sm[i] + sm[i - 1];
  }

  // simple local maxima
  const peaks: Array<{ i: number; v: number }> = [];
  for (let i = 1; i < n - 1; i++) {
    if (sm[i] > sm[i - 1] && sm[i] > sm[i + 1]) peaks.push({ i, v: sm[i] });
  }
  peaks.sort((a, b) => b.v - a.v);
  const top = peaks.slice(0, Math.max(1, k));

  const total = bins.counts.reduce((a, b) => a + b, 0) || 1;

  // match your Nucleus type exactly
  const nuclei: Nucleus[] = top.map(({ i, v }) => ({
    binIndex: i,
    density: v / total,
    firstDegree: first[i] ?? 0,
    secondDegree: second[i] ?? 0,
  }));

  return nuclei;
}

// ---------- Floating Mode (metrics) ----------

export function computeFM(
  points: MarketPoint[],
  opening: OpeningExact,
  cfg: Partial<IdhrConfig> = {},
) {
  const C: IdhrConfig = { ...DEFAULT_IDHR, ...cfg };
  const hist = computeIdhrBins(points, opening, C);

  const modeIdx = argMax(hist.counts);
  const gfm = hist.edges[modeIdx] ?? 0;

  const p0 = Number(opening?.benchmark ?? 0);
  const rets: number[] = [];
  for (const p of points) {
    const px = Number(p?.price ?? 0);
    if (Number.isFinite(px) && px > 0 && Number.isFinite(p0) && p0 > 0) {
      rets.push(Math.log(px / p0));
    }
  }

  const sigma = hist.sigmaGlobal;
  const zAbs = rets.length
    ? rets.reduce((a, r) => a + Math.abs((r - hist.muR) / (sigma || 1)), 0) / rets.length
    : 0;

  // crude inner/outer mass around the mode
  const leftCount  = hist.counts.slice(0, modeIdx).reduce((a, b) => a + b, 0);
  const rightCount = hist.counts.slice(modeIdx + 1).reduce((a, b) => a + b, 0);
  const vInner = Math.max(0, Math.min(leftCount, rightCount));
  const vOuter = Math.max(0, leftCount + rightCount - vInner);

  // histogram roughness indicators
  const center = hist.muR;
  const inertia = rets.reduce((acc, r) => acc + (r - center) ** 2, 0) / (rets.length || 1);
  const sm = smooth1d(hist.counts, 3);
  let disruption = 0;
  for (let i = 1; i < sm.length; i++) disruption += Math.abs(sm[i] - sm[i - 1]);
  disruption /= (sm.length || 1);

  const nuclei = extractNuclei(hist, C.topN);

  return {
    gfm,
    confidence: 1 / (1 + zAbs),
    inertia,
    disruption,
    zMeanAbs: zAbs,
    sigmaGlobal: sigma,
    vInner,
    vOuter,
    nuclei, // matches Nucleus type used in your repo
  };
}

// ---------- Helpers ----------

export function computeIdhrBinsN(
  points: MarketPoint[],
  opening: OpeningExact,
  cfg: Partial<IdhrConfig> = {},
  N = 128
) {
  return computeIdhrBins(points, opening, { ...cfg, totalBins: N });
}

export function serializeIdhr(idhr: IdhrBins) {
  return {
    edges: idhr.edges,
    counts: idhr.counts,
    probs: idhr.probs,
    muR: idhr.muR,
    stdR: idhr.stdR,
    sigmaGlobal: idhr.sigmaGlobal,
  };
}

// Keep buildStrAux compatibility if it imports { idhr }
export function idhr(
  points: MarketPoint[],
  opening: OpeningExact,
  cfg: Partial<IdhrConfig> = {}
): IdhrResult {
  const bins = computeIdhrBins(points, opening, cfg);
  const nuclei = extractNuclei(bins, (cfg.topN ?? DEFAULT_IDHR.topN));
  return { nuclei, sampleFirstDegrees: [], outlierCount: 0 };
}
