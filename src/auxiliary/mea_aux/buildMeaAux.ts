// src/lab/mea-aux/buildMeaAux.ts
import type { TierRule } from "./tiers";
import { getTierWeighting, DEFAULT_TIER_RULES } from "./tiers";
import { getFrozenSetFromMatricesLatest } from "@/core/frozen";

export type IdPctGrid = Record<string, Record<string, number | null>>; // id_pct[BASE][QUOTE]
export type BalancesMap = Record<string, number>;
export type MeaAuxGrid = Record<string, Record<string, number | null>>;

export type BuildMeaAuxParams = {
  coins: string[];
  idPct: IdPctGrid;         // latest snapshot id_pct (after inverse fill)
  balances: BalancesMap;    // wallet free qty per asset (asset units)
  k?: number;               // number of targeted coins (defaults to coins.length - 1)
  rules?: TierRule[];       // editable tier rules
  coverage?: Record<string, Record<string, boolean>>; // optional direct-market mask
};

export type BuildMeaAuxForCycleParams = BuildMeaAuxParams & {
  appSessionId: string;
  cycleTs: number;          // epoch-ms (same cycle as matrices/cin)
};

export type MeaPair = {
  base: string;
  quote: string;
  value: number;            // 0 if frozen
  tier_id?: number;         // optional; UI can auto-rank if absent
  frozen?: boolean;         // true if frozen by id_pct flags
};

export type MeaAuxResult = {
  coins: string[];
  grid: MeaAuxGrid;         // BASE->QUOTE value (null on diagonal / no market)
  pairs: MeaPair[];         // flat view with frozen annotations
};

/** Pure MEA computation (no frozen logic) */
export function buildMeaAux(params: BuildMeaAuxParams): MeaAuxGrid {
  const { coins, idPct, balances, coverage, rules = DEFAULT_TIER_RULES } = params;
  const k = Math.max(1, params.k ?? (coins.length - 1));

  const out: MeaAuxGrid = {};
  for (const base of coins) {
    const avail = balances[base] ?? 0;
    const row: Record<string, number | null> = {};
    for (const quote of coins) {
      if (quote === base) {
        row[quote] = null;
        continue;
      }
      // respect direct-only markets if a coverage mask is provided
      if (coverage && coverage[base] && coverage[base][quote] === false) {
        row[quote] = null;
        continue;
      }
      const idp = idPct?.[base]?.[quote];
      const w = getTierWeighting(Number(idp ?? 0), rules);
      row[quote] = avail * (1 / k) * w;
    }
    out[base] = row;
  }
  return out;
}

/** Build MEA for a cycle and apply frozen flags from matrices (id_pct) */
export async function buildMeaAuxForCycle(params: BuildMeaAuxForCycleParams): Promise<MeaAuxResult> {
  const { appSessionId, cycleTs, coins } = params;

  // 1) compute base grid (no frozen)
  const grid = buildMeaAux(params);

  // 2) retrieve frozen flags from matrices/latest (authoritative)
  const frozenSet = await getFrozenSetFromMatricesLatest(appSessionId, cycleTs);

  // 3) translate grid → pairs and zero-out frozen cells
  const pairs: MeaPair[] = [];
  for (const base of coins) {
    for (const quote of coins) {
      if (quote === base) continue;
      const key = `${base.toUpperCase()}|${quote.toUpperCase()}`;
      const frozen = frozenSet.has(key);
      const v = Number(grid[base]?.[quote] ?? 0);
      const value = frozen ? 0 : (Number.isFinite(v) ? v : 0);
      pairs.push({ base, quote, value, frozen });
    }
  }

  // 4) also reflect zeros back into the grid so any consumer is consistent
  for (const p of pairs) {
    if (p.frozen) {
      if (!grid[p.base]) grid[p.base] = {};
      grid[p.base][p.quote] = 0;
    }
  }

  return { coins, grid, pairs };
}
