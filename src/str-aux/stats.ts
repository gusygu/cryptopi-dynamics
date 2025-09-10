// src/lab/aux-str/stats.ts
import type { IdhrResult, Point, Stats } from "./types";

// NEW: robust tendency utilities (vInner per nucleus, vOuter as composition)
import {
  computeInner,
  composeOuter,
  type Nucleus,
  type NucleusSample,
} from "@/str-aux/tendency";

import {
  inertiaDisruptionFromSamples,
  type Sample1D
} from "@/str-aux/inertia_disruption";

/**
 * Descriptive stats and GFM estimation.
 * Updated to use robust tendency-vectors:
 *  - vInner (per nucleus): (1/W) * Σ w_i * tanh((p_i - c)/σ)  [robust center/scale inside nucleus]
 *  - vOuter: composition (sum) over nuclei vInner_k
 * Other fields preserved from prior behavior.
 */
export function computeStats(
  points: Point[],
  idhr: IdhrResult,
  refGfm: number | undefined
): Stats {
  if (!points.length || idhr.sampleFirstDegrees.length === 0) {
    return {
      zAbs: 0, sigma: 0, gfm: refGfm ?? 0, deltaGfm: 0, shifted: false,
      vInner: 0, vOuter: 0, refGfm: refGfm ?? 0,
      // OPTIONAL: if your Stats type doesn’t yet include these, add them there.
      inertia: 0, disruption: 0,
    } as any;
  }

  // ---------- sample-space filtering ----------
  const min = Math.min(...points.map(p => p.price));
  const max = Math.max(...points.map(p => p.price));
  const span = Math.max(1e-9, max - min);

  const inSample = (p: Point) => {
    const norm = Math.min(1, Math.max(0, (p.price - min) / span));
    const idx = Math.min(127, Math.max(0, Math.floor(norm * 128)));
    const fd = Math.floor(idx / 8) + 1;
    return idhr.sampleFirstDegrees.includes(fd);
  };

  const samplePts = points.filter(inSample);
  const values = samplePts.map(p => p.price);

  // ---------- dispersion ----------
  const mean = avg(values);
  const variance = avg(values.map(v => (v - mean) ** 2));
  const sigma = Math.sqrt(variance);
  const zAbs = sigma > 0 ? avg(values.map(v => Math.abs((v - mean) / sigma))) : 0;

  // ---------- GFM ----------
  const densSum = idhr.nuclei.reduce((a, n) => a + n.density, 0) || 1;
  const gfm = idhr.nuclei.reduce((acc, n) => {
    const center = n.binIndex / 127; // 0..1
    return acc + center * (n.density / densSum);
  }, 0);

  const ref = refGfm ?? gfm;
  const deltaGfm = gfm - ref;
  const THRESH = 0.035;
  const shifted = Math.abs(deltaGfm) >= THRESH;

  // ---------- Tendency vectors ----------
  const bucketed: Record<number, NucleusSample[]> = {};
  for (const p of samplePts) {
    const norm = Math.min(1, Math.max(0, (p.price - min) / span));
    const bin = Math.min(127, Math.max(0, Math.round(norm * 127)));
    (bucketed[bin] ??= []).push({ p: p.price, w: 1 });
  }

  const nuclei: Nucleus[] = idhr.nuclei.map(n => ({
    samples: bucketed[n.binIndex] ?? [],
  }));

  const vInners = nuclei.map(computeInner);
  const vOuter = composeOuter(vInners);
  const vInner = vInners.length ? avg(vInners) : 0;

  // ---------- Inertia & Disruption (geometric style) ----------
  // Use same sample space; weights default to 1 (swap for volume/liquidity if available).
  const samplesForID: Sample1D[] = samplePts.map(p => ({ p: p.price, w: 1 }));
  const { inertia, disruption } = inertiaDisruptionFromSamples(
    samplesForID,
    vInner,
    vOuter,
    /* center */ mean,
    /* mode */ "balanced"
  );

  // ---------- return ----------
  return {
    zAbs, sigma, gfm, deltaGfm, shifted,
    vInner, vOuter, refGfm: ref,
    inertia, disruption,
  } as any;
}

// ---------- utils ----------
function avg(a: number[]) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}