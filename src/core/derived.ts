// Settings-aware derived matrices (id_pct, pct_drv) that align with current db.ts helpers.

import { getAll as getSettings } from "@/lib/settings/server";
import { getPrevSnapshotByType } from "@/core/db";
import { antisymmetrize } from "./math/utils";

const num = (v: any, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);

async function resolveLookbackMs(): Promise<number> {
  try {
    const s = await getSettings().catch(() => null) as any;
    const ms = num(s?.timing?.lookbackMs, NaN);
    if (Number.isFinite(ms) && ms > 0) return ms;
    const sec = num(s?.poller?.dur40 ?? s?.metronome?.dur40, NaN);
    if (Number.isFinite(sec) && sec > 0) return Math.round(sec * 1000);
  } catch {}
  return 40_000;
}

function toMap(rows: Array<{ base: string; quote: string; value: number }>) {
  const m: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const b = String(r.base).toUpperCase();
    const q = String(r.quote).toUpperCase();
    if (!m[b]) m[b] = {};
    m[b][q] = Number(r.value);
  }
  return m;
}

/**
 * Derived matrices:
 *  - id_pct  = (benchmark_now - benchmark_prev)/benchmark_prev
 *  - pct_drv = id_pct_now - id_pct_prev(lookback)
 *
 * @param coins     ordered list used by the benchmark matrix
 * @param ts_ms     "now" timestamp (ms) used when writing current matrices
 * @param benchmark current benchmark matrix (coins.length x coins.length)
 */
export async function computeDerived(
  coins: string[],
  ts_ms: number,
  benchmark: (number | null)[][]
) {
  const n = coins.length;
  const id_pct  = Array.from({ length: n }, () => Array<number | null>(n).fill(null));
  const pct_drv = Array.from({ length: n }, () => Array<number | null>(n).fill(null));

  const lookbackMs = await resolveLookbackMs();
  const epsAbs = 1e-12;

  // Pull previous snapshots once, then index in-memory.
  const prevBenchRows = await getPrevSnapshotByType("benchmark", ts_ms, coins);
  const prevIdRows    = await getPrevSnapshotByType("id_pct", ts_ms - lookbackMs, coins);
  const benchPrevMap  = toMap(prevBenchRows);
  const idPrevMap     = toMap(prevIdRows);

  // id_pct now
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const A = coins[i]!, B = coins[j]!;
      const curr = benchmark[i]?.[j];
      if (curr == null || !Number.isFinite(curr)) continue;

      const prev = benchPrevMap[A]?.[B];
      if (prev == null || !Number.isFinite(prev) || Math.abs(prev) < epsAbs) continue;

      id_pct[i][j] = (curr - prev) / prev;
    }
  }

  // pct_drv = id_now - id_prev(lookback)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const A = coins[i]!, B = coins[j]!;
      const now = id_pct[i]?.[j];
      if (now == null || !Number.isFinite(now)) continue;

      const prev = idPrevMap[A]?.[B];
      if (prev == null || !Number.isFinite(prev)) continue;

      pct_drv[i][j] = now - prev;
    }
  }

  return {
    id_pct : antisymmetrize(id_pct),
    pct_drv: antisymmetrize(pct_drv),
  };
}
