// src/lab/mea-aux/tiers.ts
export type TierRule = { min: number; max: number; weight: number }; // [min, max)

export const DEFAULT_TIER_RULES: TierRule[] = [
  { min: -Infinity, max: -0.02, weight: 0.85 },
  { min: -0.02,    max: -0.005, weight: 0.95 },
  { min: -0.005,   max:  0.005, weight: 1.00 },
  { min:  0.005,   max:  0.02,  weight: 1.05 },
  { min:  0.02,    max:  Infinity, weight: 1.15 },
];

// Returns the first matching rule, else 1.0
export function getTierWeighting(idPct: number, rules: TierRule[] = DEFAULT_TIER_RULES): number {
  for (const r of rules) {
    if (idPct >= r.min && idPct < r.max) return r.weight;
  }
  return 1.0;
}
