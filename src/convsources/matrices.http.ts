/* ----------------------------------------------------------------------------------
 * File: src/converters/providers/matrices.http.ts
 * Purpose: Fetch matrices from /api/matrices/latest keyed by coins (no-store).
 * ---------------------------------------------------------------------------------- */
import type { MatricesProvider } from "@/converters/provider.types";

type LatestPayload = {
  ok: boolean;
  coins: string[];
  matrices: Array<{ key: string; grid: number[][] }>;
};

export function makeMatricesHttpProvider(base = ""): MatricesProvider {
  async function fetchLatest(coins: string[]) {
    const qs = new URLSearchParams({
      coins: coins.join(","),
      t: String(Date.now()),   // cache-bust for edges/CDN
    });
    const r = await fetch(`${base}/api/matrices/latest?${qs}`, {
      cache: "no-store",
      next: { revalidate: 0 },
    });
    if (!r.ok) throw new Error(`matrices http ${r.status}`);
    const j = (await r.json()) as LatestPayload;
    return j;
  }

  return {
    async getBenchmarkGrid(coins) {
      const j = await fetchLatest(coins);
      return j.matrices.find(m => m.key === "benchmark")?.grid;
    },
    async getIdPctGrid(coins) {
      const j = await fetchLatest(coins);
      return j.matrices.find(m => m.key === "id_pct")?.grid;
    },
  };
}
