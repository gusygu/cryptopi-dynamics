// src/lib/str-aux/config.ts
import { getSettingsServer } from "@/lib/settings/server";

export type StrAuxConfig = {
  baseMs: number;
  cycles: { m30: number; h1: number; h3: number };
  params: Record<string, number>;
  histLen: number;
};

export async function getStrAuxConfig(): Promise<StrAuxConfig> {
  const s = await getSettingsServer();
  const baseMs = Math.max(500, Number(s.timing?.autoRefreshMs ?? 40_000));
  const cycles = {
    m30: Math.max(1, Number(s.timing?.strCycles?.m30 ?? 45)),
    h1:  Math.max(1, Number(s.timing?.strCycles?.h1  ?? 90)),
    h3:  Math.max(1, Number(s.timing?.strCycles?.h3  ?? 270)),
  };
  const params = { ...(s.params?.values ?? {}) };
  const histLen = Math.max(16, Number(s.stats?.histogramLen ?? 64));
  return { baseMs, cycles, params, histLen };
}
