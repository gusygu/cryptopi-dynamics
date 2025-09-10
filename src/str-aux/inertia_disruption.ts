// src/strategy_aux/inertia_disruption.ts
// Geometric-style inertia & disruption built on top of our tendency vectors.
// Focus here is SINGLE-COIN local geometry; ecosystem (4-coin) helpers can be added later.

export type InertiaDisruption = {
  /** inertia: resistance to displacement around local center (∑ w (p - c)^2) */
  inertia: number;
  /** disruption: relative “force” from tendencies vs. inertia */
  disruption: number;
};

/** small epsilon */
const EPS = 1e-9;

export type Sample1D = { p: number; w?: number };

/** weighted mean */
function wmean(xs: Sample1D[], fallback = 0): number {
  let sw = 0, sp = 0;
  for (const { p, w } of xs) {
    const ww = w ?? 1;
    if (ww > 0) { sw += ww; sp += ww * p; }
  }
  return sw > 0 ? sp / sw : fallback;
}

/**
 * Local inertia around the (weighted) center:
 *   I = Σ w_i (p_i - c)^2
 */
export function computeInertia(samples: Sample1D[], center?: number): number {
  if (!samples.length) return 0;
  const c = center ?? wmean(samples, 0);
  let I = 0;
  for (const { p, w } of samples) {
    const ww = w ?? 1;
    const r = p - c;
    I += ww * r * r;
  }
  return I;
}

/**
 * Disruption score — how strong the current tendencies are vs. local inertia.
 * Default (balanced):  D = (|vOuter| + |vInner|) / (I + ε)
 * You can switch to outer-only with mode="outer".
 */
export function computeDisruption(
  vInner: number,
  vOuter: number,
  inertia: number,
  mode: "balanced" | "outer" = "balanced"
): number {
  const numer = mode === "outer" ? Math.abs(vOuter) : Math.abs(vOuter) + Math.abs(vInner);
  return numer / (Math.abs(inertia) + EPS);
}

/**
 * Convenience: from raw price samples (weights optional).
 * Returns { inertia, disruption } using the given vInner/vOuter.
 */
export function inertiaDisruptionFromSamples(
  samples: Sample1D[],
  vInner: number,
  vOuter: number,
  center?: number,
  mode: "balanced" | "outer" = "balanced"
): InertiaDisruption {
  const I = computeInertia(samples, center);
  const D = computeDisruption(vInner, vOuter, I, mode);
  return { inertia: I, disruption: D };
}
