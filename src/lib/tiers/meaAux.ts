// src/lib/tiers/meaAux.ts
export type MeaAuxTierName = "alpha" | "beta" | "gamma" | "delta" | "epsilon";
export type MeaAuxResult = {
  tier?: MeaAuxTierName;
  name?: string;
  weight: number;          // signed: + for negative id_pct, - for positive id_pct
  unsignedWeight: number;
  isNull: boolean;
};

const BINS = [
  { name: "alpha",   written: "Alpha",   min: 0.00016, max: 0.00032, weight: 0.15 },
  { name: "beta",    written: "Beta",    min: 0.00033, max: 0.00045, weight: 0.55 },
  { name: "gamma",   written: "Gamma",   min: 0.00046, max: 0.00076, weight: 1.15 },
  { name: "delta",   written: "Delta",   min: 0.00077, max: 0.00120, weight: 0.65 },
  { name: "epsilon", written: "Epsilon", min: 0.00121, max: null,     weight: 0.50 },
] as const;

export function computeMeaAux(id_pct: number): MeaAuxResult {
  if (Object.is(id_pct, 0) || Math.abs(id_pct) === 0) {
    return { isNull: true, weight: 0, unsignedWeight: 0 };
  }
  const mag = Math.abs(id_pct);
  const sign = id_pct > 0 ? -1 : +1;

  const bin = BINS.find(b => mag >= b.min && (b.max == null || mag <= b.max));
  if (!bin) {
    return { isNull: false, tier: "alpha", name: "Alpha", weight: sign * 0.0, unsignedWeight: 0.0 };
  }
  return {
    isNull: false,
    tier: bin.name,
    name: bin.written,
    weight: sign * bin.weight,
    unsignedWeight: bin.weight,
  };
}

// shared formatters (we’ll reuse later for matrices precision)
export const fmt6 = (n: number) => (Number.isFinite(n) ? n.toFixed(6) : "—");
export const fmt4 = (n: number) => (Number.isFinite(n) ? n.toFixed(4) : "—");
