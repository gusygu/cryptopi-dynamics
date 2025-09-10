"use server";

import { cookies } from "next/headers";
import type { AppSettings } from "./schema";
import { DEFAULT_SETTINGS } from "./schema";

const COOKIE_KEY = "cp_settings_v1";
const ONE_YEAR = 60 * 60 * 24 * 365;

/* ---------- helpers ---------- */

function normCoins(list: any): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of (Array.isArray(list) ? list : []) as string[]) {
    const u = String(c || "").trim().toUpperCase();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  if (!seen.has("USDT")) out.push("USDT");
  return out;
}

function sanitize(input: any): AppSettings {
  const base = structuredClone(DEFAULT_SETTINGS);
  const s = (input && typeof input === "object") ? input : {};

  const version = Number(s.version ?? base.version) || base.version;

  // required blocks (fallback to DEFAULT_SETTINGS if absent)
  const profile =
    (s?.profile && typeof s.profile === "object") ? s.profile : base.profile;

  const stats =
    (s?.stats && typeof s.stats === "object") ? s.stats : base.stats;

  const coinUniverse = normCoins(s?.coinUniverse ?? base.coinUniverse);

  const clustering = Array.isArray(s?.clustering?.clusters)
    ? {
        clusters: s.clustering.clusters.map((c: any, i: number) => ({
          id: c?.id || `cl-${i + 1}`,
          name: c?.name || `Cluster ${i + 1}`,
          coins: normCoins(c?.coins || []),
        })),
      }
    : base.clustering;

  const timing = {
    // keep flag present for callers & schema
    autoRefresh: !!s?.timing?.autoRefresh,
    autoRefreshMs:
      Number(s?.timing?.autoRefreshMs ?? base.timing.autoRefreshMs) ||
      base.timing.autoRefreshMs,
    secondaryEnabled: !!s?.timing?.secondaryEnabled,
    secondaryCycles: Math.max(
      1,
      Math.min(
        10,
        Number(s?.timing?.secondaryCycles ?? base.timing.secondaryCycles) ||
          base.timing.secondaryCycles
      )
    ),
    strCycles: {
      m30:
        Math.max(
          1,
          Number(s?.timing?.strCycles?.m30 ?? base.timing.strCycles.m30) ||
            base.timing.strCycles.m30
        ),
      h1:
        Math.max(
          1,
          Number(s?.timing?.strCycles?.h1 ?? base.timing.strCycles.h1) ||
            base.timing.strCycles.h1
        ),
      h3:
        Math.max(
          1,
          Number(s?.timing?.strCycles?.h3 ?? base.timing.strCycles.h3) ||
            base.timing.strCycles.h3
        ),
    },
  };

  const params = {
    values:
      (s?.params?.values && typeof s.params.values === "object")
        ? s.params.values
        : base.params.values,
  };

  // shape matches AppSettings; no type-assertion needed
  return {
    version,
    profile,
    coinUniverse,
    clustering,
    timing,
    params,
    stats,
  };
}

/* ---------- public API (server) ---------- */

/** Read settings from cookie (or defaults). */
export async function getAll(): Promise<AppSettings> {
  const ck = await cookies();
  const raw = ck.get(COOKIE_KEY)?.value;
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw);
    return sanitize(parsed);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Back-compat alias: some modules import { getSettingsServer } */
export const getSettingsServer = getAll;

/** Persist settings into cookie (use from API routes / server actions). */
export async function setAll(nextValue: AppSettings): Promise<void> {
  const ck = await cookies();
  const val = JSON.stringify(sanitize(nextValue));
  ck.set(COOKIE_KEY, val, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR,
  });
}

/** Convenience: normalized coin universe (always includes USDT). */
export async function resolveCoinsFromSettings(): Promise<string[]> {
  const s = await getAll();
  return normCoins(
    s.coinUniverse?.length ? s.coinUniverse : DEFAULT_SETTINGS.coinUniverse
  );
}
