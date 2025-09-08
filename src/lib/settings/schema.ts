// src/lib/settings/schema.ts
export type Cluster = { id: string; name: string; coins: string[] };

export type AppSettings = {
  version: number;
  coinUniverse: string[];
  profile: { nickname: string; email: string; binanceKeyId: string };
  stats: { histogramLen: number; bmDecimals: number; idPctDecimals: number };
  timing: {
    autoRefresh: boolean;
    autoRefreshMs: number;
    secondaryEnabled: boolean;
    secondaryCycles: number;               // 1..10
    strCycles: { m30: number; h1: number; h3: number }; // measured in cycles
  };
  clustering: { clusters: Cluster[] };
  params: { values: Record<string, number> };
};

export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS: AppSettings = {
  version: SETTINGS_VERSION,
  coinUniverse: [],
  profile: { nickname: "", email: "", binanceKeyId: "" },
  stats: { histogramLen: 64, bmDecimals: 4, idPctDecimals: 6 },
  timing: {
    autoRefresh: true,
    autoRefreshMs: 40_000,
    secondaryEnabled: true,
    secondaryCycles: 3,
    strCycles: { m30: 45, h1: 90, h3: 270 },
  },
  clustering: { clusters: [{ id: "cl-1", name: "Cluster 1", coins: [] }] },
  params: { values: { eta: 0.02, epsilon: 1e-6 } },
};

// Defensive load + normalize + migrate
export function migrateSettings(input: unknown): AppSettings {
  const s = (input || {}) as Partial<AppSettings>;
  const u = (xs?: string[]) =>
    Array.from(new Set((xs ?? []).map((x) => String(x).toUpperCase())));
  const num = (v: any, d: number) => (Number.isFinite(+v) ? +v : d);

  const out: AppSettings = {
    version: SETTINGS_VERSION,
    coinUniverse: u(s.coinUniverse),
    profile: {
      nickname: String(s.profile?.nickname ?? ""),
      email: String(s.profile?.email ?? ""),
      binanceKeyId: String(s.profile?.binanceKeyId ?? ""),
    },
    stats: {
      histogramLen: Math.max(16, num(s.stats?.histogramLen, DEFAULT_SETTINGS.stats.histogramLen)),
      bmDecimals: Math.max(0, Math.min(6, num(s.stats?.bmDecimals, DEFAULT_SETTINGS.stats.bmDecimals))),
      idPctDecimals: Math.max(0, Math.min(8, num(s.stats?.idPctDecimals, DEFAULT_SETTINGS.stats.idPctDecimals))),
    },
    timing: {
      autoRefresh: Boolean(s.timing?.autoRefresh ?? DEFAULT_SETTINGS.timing.autoRefresh),
      autoRefreshMs: Math.max(500, num(s.timing?.autoRefreshMs, DEFAULT_SETTINGS.timing.autoRefreshMs)),
      secondaryEnabled: Boolean(s.timing?.secondaryEnabled ?? DEFAULT_SETTINGS.timing.secondaryEnabled),
      secondaryCycles: Math.max(1, Math.min(10, num(s.timing?.secondaryCycles, DEFAULT_SETTINGS.timing.secondaryCycles))),
      strCycles: {
        m30: Math.max(1, num(s.timing?.strCycles?.m30, DEFAULT_SETTINGS.timing.strCycles.m30)),
        h1:  Math.max(1, num(s.timing?.strCycles?.h1,  DEFAULT_SETTINGS.timing.strCycles.h1)),
        h3:  Math.max(1, num(s.timing?.strCycles?.h3,  DEFAULT_SETTINGS.timing.strCycles.h3)),
      },
    },
    clustering: {
      clusters: Array.isArray(s.clustering?.clusters)
        ? s.clustering!.clusters.map((c, i) => ({
            id: String(c?.id ?? `cl-${i + 1}`),
            name: String(c?.name ?? `Cluster ${i + 1}`),
            coins: u((c as any)?.coins),
          }))
        : DEFAULT_SETTINGS.clustering.clusters,
    },
    params: { values: { ...DEFAULT_SETTINGS.params.values, ...(s.params?.values ?? {}) } },
  };

  return out;
}
