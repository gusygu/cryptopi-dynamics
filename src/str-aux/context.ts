// src/strategy/aux/context.ts
"use server";

import { getAll } from "@/lib/settings/server"; // settings source of truth (server)  :contentReference[oaicite:3]{index=3}

export type StrategyAuxTiming = {
  autoRefresh: boolean;
  autoRefreshMs: number;
  secondaryEnabled: boolean;
  secondaryCycles: number;
  strCycles: {
    m30: number;
    h1: number;
    h3: number;
  };
};

function normCoins(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of list ?? []) {
    const u = String(c || "").trim().toUpperCase();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  if (!seen.has("USDT")) out.push("USDT");
  return out;
}

/** Loads settings and returns normalized coin universe (always includes USDT). */
export async function getAuxCoins(): Promise<string[]> {
  const s = await getAll(); // cookie → sanitized settings  :contentReference[oaicite:4]{index=4}
  return normCoins(s.coinUniverse ?? []);
}

/** Returns the timing block used by str-aux cycles. */
export async function getAuxTiming(): Promise<StrategyAuxTiming> {
  const s = await getAll(); //  :contentReference[oaicite:5]{index=5}
  // Pass through with explicit typing for clarity
  return {
    autoRefresh: !!s.timing.autoRefresh,
    autoRefreshMs: Number(s.timing.autoRefreshMs || 0),
    secondaryEnabled: !!s.timing.secondaryEnabled,
    secondaryCycles: Number(s.timing.secondaryCycles || 1),
    strCycles: {
      m30: Number(s.timing.strCycles.m30 || 1),
      h1: Number(s.timing.strCycles.h1 || 1),
      h3: Number(s.timing.strCycles.h3 || 1),
    },
  };
}
