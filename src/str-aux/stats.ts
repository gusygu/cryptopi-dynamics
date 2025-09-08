// src/lab/aux-str/stats.ts
import type { IdhrResult, Point, Stats } from "./types";

/**
 * Descriptive stats and GFM estimation.
 * These are conservative, easily swappable placeholders:
 *  - sigma: stddev of prices over sample space
 *  - zAbs: mean(|z|) over sample space
 *  - gfm: weighted center of nuclei ∈ [0, 1] by density
 *  - deltaGfm: gfm - refGfm (from previous persisted state)
 *  - shifted: |deltaGfm| ≥ THRESH triggers shift
 *  - vInner/vOuter: simple tendency proxy using median split
 */
export function computeStats(
  points: Point[],
  idhr: IdhrResult,
  refGfm: number | undefined
): Stats {
  if (!points.length || idhr.sampleFirstDegrees.length === 0) {
    return {
      zAbs: 0, sigma: 0, gfm: refGfm ?? 0, deltaGfm: 0, shifted: false, vInner: 0, vOuter: 0, refGfm: refGfm ?? 0,
    };
  }

  // filter to sample space
  const min = Math.min(...points.map(p => p.price));
  const max = Math.max(...points.map(p => p.price));
  const span = Math.max(1e-9, max - min);

  const sample = points.filter(p => {
    const norm = Math.min(1, Math.max(0, (p.price - min) / span));
    const idx = Math.min(127, Math.max(0, Math.floor(norm * 128)));
    const fd = Math.floor(idx / 8) + 1;
    return idhr.sampleFirstDegrees.includes(fd);
  });

  const values = sample.map(p => p.price);
  const mean = avg(values);
  const variance = avg(values.map(v => (v - mean) ** 2));
  const sigma = Math.sqrt(variance);

  const zAbs = sigma > 0 ? avg(values.map(v => Math.abs((v - mean) / sigma))) : 0;

  // GFM = weighted normalized center of nuclei
  const densSum = idhr.nuclei.reduce((a, n) => a + n.density, 0) || 1;
  const gfm = idhr.nuclei.reduce((acc, n) => {
    const center = n.binIndex / 127; // 0..1
    return acc + center * (n.density / densSum);
  }, 0);

  const ref = refGfm ?? gfm; // if first run, lock ref to current
  const deltaGfm = gfm - ref;

  // shift heuristic
  const THRESH = 0.035; // tweakable; placeholder consistent threshold
  const shifted = Math.abs(deltaGfm) >= THRESH;

  // tendency vectors via median split
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const inner = sorted.slice(0, mid);
  const outer = sorted.slice(mid);
  const vInner = inner.length ? avg(inner.map(v => (v - mean))) : 0;
  const vOuter = outer.length ? avg(outer.map(v => (v - mean))) : 0;

  return { zAbs, sigma, gfm, deltaGfm, shifted, vInner, vOuter, refGfm: ref };
}

function avg(a: number[]) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}
