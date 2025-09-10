// src/core/math/matrices.ts
// Matrices built from per-coin USDT data (triangulation), compatible with routes/UI.
// - benchmark(A/B) := (priceA_USDT / priceB_USDT)
// - pct24h(A/B)    := (pctA - pctB) / 100  (stored as decimal, e.g. 0.0231)
// - delta(A/B)     := approximate absolute delta for A/B derived from coin deltas
//
// Notes:
// * We intentionally avoid relying on direct A/B tickers (e.g. BTCETH) since many are missing.
// * Return shape stays identical to the previous version so downstream code is unaffected.

import { newGrid, invertGrid, antisymmetrize } from "./utils";

// 24h ticker subset keyed by symbol, e.g. { "BTCUSDT": { lastPrice, priceChangePercent, ... } }
export type Ticker24h = {
  symbol: string;
  weightedAvgPrice?: string;
  lastPrice?: string;
  priceChangePercent?: string; // "-1.234"
};

type Tmap = Record<string, Ticker24h>;

const symUsdt = (coin: string) => `${String(coin || "").toUpperCase()}USDT`;

/**
 * Produce benchmark / delta / pct24h matrices for a coin list using
 * triangulation through USDT.
 *
 * Input:
 *  - coins: ["BTC","ETH","BNB",...]
 *  - tmap:  { "BTCUSDT": { ... }, "ETHUSDT": { ... }, ... }
 *
 * Output:
 *  - benchmark[i][j] = price(coins[i])/price(coins[j])
 *  - pct24h[i][j]    = (pct[i] - pct[j]) / 100  (decimal)
 *  - delta[i][j]     = approx abs delta for A/B from per-coin deltas (antisym filled)
 */
export function buildPrimaryDirect(coins: string[], tmap: Tmap) {
  const n = coins.length;
  const bench = newGrid<number | null>(n, null);
  const delta = newGrid<number | null>(n, null);
  const pct   = newGrid<number | null>(n, null);

  // Pre-extract per-coin last price and pct (% number, not decimal)
  const priceUSDT: Record<string, number | null> = {};
  const pctUSDT:   Record<string, number | null> = {};
  const dltUSDT:   Record<string, number | null> = {}; // approx abs delta in USDT

  for (const c of coins) {
    const t = tmap[symUsdt(c)];
    const last = t?.weightedAvgPrice != null ? Number(t.weightedAvgPrice) :
                 t?.lastPrice         != null ? Number(t.lastPrice)         : NaN;
    const pctp = t?.priceChangePercent != null ? Number(t.priceChangePercent) : NaN;

    priceUSDT[c] = Number.isFinite(last) ? last : null;
    pctUSDT[c]   = Number.isFinite(pctp) ? pctp : null;

    // approximate absolute delta in USDT space:
    // Δ ≈ last * (pct% / 100)
    dltUSDT[c] = (Number.isFinite(last) && Number.isFinite(pctp)) ? last * (pctp / 100) : null;
  }

  // Build matrices by triangulation
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const A = coins[i], B = coins[j];
      const pA = priceUSDT[A], pB = priceUSDT[B];
      const qA = pctUSDT[A],   qB = pctUSDT[B];
      const dA = dltUSDT[A],   dB = dltUSDT[B];

      // benchmark(A/B) = pA/pB
      bench[i][j] = (pA != null && pB != null && pB !== 0) ? (pA / pB) : null;

      // pct24h(A/B) as decimal: (pctA - pctB)/100
      pct[i][j] = (qA != null && qB != null) ? ((qA - qB) / 100) : null;

      // delta(A/B): Δ_AB ≈ (ΔA/pB) - (pA*ΔB/pB^2) = (ΔA/pB) - (pA/pB)*(ΔB/pB)
      // This is a first-order approximation consistent with bench triangulation.
      if (pB != null && pB !== 0 && dA != null && dB != null && pA != null) {
        const term1 = dA / pB;
        const term2 = (pA / pB) * (dB / pB);
        delta[i][j] = term1 - term2;
      } else {
        delta[i][j] = null;
      }
    }
  }

  // Fill the missing half consistently:
  const benchmark = invertGrid(bench);   // A/B ↔ B/A = 1/x
  const pct24h    = antisymmetrize(pct); // A/B ↔ B/A = -x (decimal)
  const deltaFilled = antisymmetrize(delta);

  return { benchmark, delta: deltaFilled, pct24h };
}

/**
 * Derived matrices:
 *  - id_pct(A/B)  = (benchmark_now - benchmark_prev) / benchmark_prev
 *  - pct_drv(A/B) = id_pct_now - id_pct_prev
 *
 * getPrev callback must fetch previous value strictly before ts_ms.
 */
export async function buildDerived(
  coins: string[],
  ts_ms: number,
  benchmark: (number | null)[][],
  getPrev: (
    matrix_type: "benchmark" | "id_pct",
    base: string,
    quote: string,
    beforeTs: number
  ) => Promise<number | null>
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

      const prev = await getPrev("benchmark", A, B, ts_ms);
      if (prev == null || !Number.isFinite(prev) || prev === 0) { id_pct[i][j] = null; continue; }

      id_pct[i][j] = (curr - prev) / prev;
    }
  }

  // 2) pct_drv as Δ of id_pct
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const A = coins[i], B = coins[j];
      const currId = id_pct[i][j];
      if (currId == null || !Number.isFinite(currId)) { pct_drv[i][j] = null; continue; }

      const prevId = await getPrev("id_pct", A, B, ts_ms);
      if (prevId == null || !Number.isFinite(prevId)) { pct_drv[i][j] = null; continue; }

      pct_drv[i][j] = currId - prevId;
    }
  }

  // Keep antisymmetric guarantee for derived matrices as well
  const id_pct_fix  = antisymmetrize(id_pct);
  const pct_drv_fix = antisymmetrize(pct_drv);

  return { id_pct: id_pct_fix, pct_drv: pct_drv_fix };
}
