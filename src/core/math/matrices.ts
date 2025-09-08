// src/math/matrices.ts
import { newGrid, invertGrid, antisymmetrize } from './utils';
import type { T24 } from '../../sources/binance';

const sym = (a: string, b: string) => `${a}${b}`.toUpperCase();

export function buildPrimaryDirect(
  coins: string[],
  tmap: Map<string, T24>
) {
  const n = coins.length;
  const bench = newGrid<number | null>(n, null);
  const delta = newGrid<number | null>(n, null);
  const pct   = newGrid<number | null>(n, null);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const t = tmap.get(sym(coins[i], coins[j]));
      if (!t) continue;

      const last = Number(t.lastPrice);
      const d    = Number(t.priceChange);
      const pctp = Number(t.priceChangePercent); // as %, e.g. 1.23

      bench[i][j] = Number.isFinite(last) ? last : null;
      delta[i][j] = Number.isFinite(d)    ? d    : null;
      pct[i][j]   = Number.isFinite(pctp) ? (pctp / 100) : null; // store as decimal
    }
  }

  // Fill the missing half:
  const benchmark = invertGrid(bench);        // A/B ↔ B/A = 1/x
  const pct24h    = antisymmetrize(pct);      // A/B ↔ B/A = -x
  // Delta can be noisy; per spec we only "inverse-fill" and do no other calc.
  // Treat it antisymmetric to fill gaps:
  const deltaFilled = antisymmetrize(delta);

  return { benchmark, delta: deltaFilled, pct24h };
}

/**
 * Derived:
 *  - id_pct(A/B)   = (benchmark_now - benchmark_prev) / benchmark_prev
 *  - pct_drv(A/B)  = id_pct_now - id_pct_prev
 *
 * getPrev is a callback to fetch previous value stored in DB strictly before ts_ms.
 */
export async function buildDerived(
  coins: string[],
  ts_ms: number,
  benchmark: (number | null)[][],
  getPrev: (matrix_type: 'benchmark' | 'id_pct', base: string, quote: string, beforeTs: number) => Promise<number | null>
) {
  const n = coins.length;
  const id_pct  = newGrid<number | null>(n, null);
  const pct_drv = newGrid<number | null>(n, null);

  // 1) id_pct from benchmark vs previous benchmark
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const A = coins[i], B = coins[j];
      const curr = benchmark[i][j];
      if (curr == null || !Number.isFinite(curr)) { id_pct[i][j] = null; continue; }

      const prev = await getPrev('benchmark', A, B, ts_ms);
      if (prev == null || !Number.isFinite(prev) || prev === 0) { id_pct[i][j] = null; continue; }

      id_pct[i][j] = (curr - prev) / prev;
    }
  }

  // 2) pct_drv as Δ of id_pct (NOT same as id_pct)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const A = coins[i], B = coins[j];
      const currId = id_pct[i][j];
      if (currId == null || !Number.isFinite(currId)) { pct_drv[i][j] = null; continue; }

      const prevId = await getPrev('id_pct', A, B, ts_ms);
      if (prevId == null || !Number.isFinite(prevId)) { pct_drv[i][j] = null; continue; }

      pct_drv[i][j] = currId - prevId;
    }
  }

  return { id_pct, pct_drv };
}
