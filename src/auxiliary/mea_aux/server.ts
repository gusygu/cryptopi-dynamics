// src/app/mea-aux/server.ts
import { computeMeaAux, fmt6 } from "@/lib/tiers/meaAux";

// Example shape — adapt types to your project.
type PairKey = string; // e.g. "ETHUSDT" or "ETH/BTC"
type MeaAuxCell = {
  id_pct: number;          // raw fraction (e.g. 0.00019657)
  weight: number;          // signed weight from tier
  tier?: string;           // "alpha" | ... | "epsilon"
  tierName?: string;       // "Alpha" | ...
  isNull: boolean;         // for yellow cell
};

export async function buildMeaAuxMatrix(idPctMatrix: Record<PairKey, Record<PairKey, number>>) {
  // idPctMatrix[A][B] = id_pct fraction (NOT percent)
  const meaAux: Record<PairKey, Record<PairKey, MeaAuxCell>> = {};

  for (const base of Object.keys(idPctMatrix)) {
    meaAux[base] = {};
    const row = idPctMatrix[base];

    for (const quote of Object.keys(row)) {
      const id_pct = row[quote];               // already a fraction
      const tier = computeMeaAux(id_pct);      // <- NEW: tier assignment

      meaAux[base][quote] = {
        id_pct,
        weight: tier.weight,
        tier: tier.tier,
        tierName: tier.name,
        isNull: tier.isNull,
      };
    }
  }

  return meaAux;
}

// If you need a flattened list for UI:
export function toRenderableRows(meaAux: Record<PairKey, Record<PairKey, MeaAuxCell>>) {
  const rows: Array<{
    base: string;
    quote: string;
    id_pct_display: string;   // 6 decimals
    weight_display: string;   // 4 decimals to keep it tidy
    tierName?: string;
    isNull: boolean;
  }> = [];

  for (const base of Object.keys(meaAux)) {
    for (const quote of Object.keys(meaAux[base])) {
      const cell = meaAux[base][quote];
      rows.push({
        base,
        quote,
        id_pct_display: fmt6(cell.id_pct),
        weight_display: Number.isFinite(cell.weight) ? cell.weight.toFixed(4) : "—",
        tierName: cell.tierName,
        isNull: cell.isNull,
      });
    }
  }

  return rows;
}
