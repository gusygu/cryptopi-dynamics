// src/auxiliary/mea_aux/tiers.ts
import { computeMeaAux } from "@/lib/tiers/meaAux";

// Kept type for compatibility with existing code
export type TierRule = {
  minAbs: number;     // inclusive
  maxAbs: number|null;// inclusive when number, null => +∞
  weight: number;     // unsigned bin weight
  name: string;       // Greek written name
  key: "alpha"|"beta"|"gamma"|"delta"|"epsilon";
};

// A default array if callers still want to inspect bins (optional usage)
export const DEFAULT_TIER_RULES: TierRule[] = [
  { key: "alpha",   name: "Alpha",   minAbs: 0.00016, maxAbs: 0.00032, weight: 0.15 },
  { key: "beta",    name: "Beta",    minAbs: 0.00033, maxAbs: 0.00045, weight: 0.55 },
  { key: "gamma",   name: "Gamma",   minAbs: 0.00046, maxAbs: 0.00076, weight: 1.15 },
  { key: "delta",   name: "Delta",   minAbs: 0.00077, maxAbs: 0.00120, weight: 0.65 },
  { key: "epsilon", name: "Epsilon", minAbs: 0.00121, maxAbs: null,     weight: 0.50 },
];

// The only number buildMeaAux actually needs:
export function getTierWeighting(id_pct: number, _rules: TierRule[] = DEFAULT_TIER_RULES): number {
  return computeMeaAux(Number(id_pct || 0)).weight;
}
