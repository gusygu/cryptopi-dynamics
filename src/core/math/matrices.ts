// Math-only helpers to build primary matrices from 24h tickers.
// No DB imports here, to avoid coupling and TS signature mismatches.

import { newGrid, invertGrid, antisymmetrize } from "./utils";

/** 24h ticker subset we need. */
export type Ticker24h = {
  symbol: string;
  weightedAvgPrice?: string | number;
  lastPrice?: string | number;
  priceChangePercent?: string | number;
};
export type TickerMap = Record<string, Ticker24h>;

const num = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const sym = (base: string, quote: string) =>
  `${String(base).toUpperCase()}${String(quote).toUpperCase()}`;
const symUsdt = (c: string) => sym(c, "USDT");

/**
 * Build benchmark, delta, pct24h from a 24h ticker map.
 * - Uses USDT bridging (A/USDT, B/USDT) for ratios.
 * - pct24h is (pctA - pctB)/100 (unitless).
 * - delta uses a simple linearized proxy based on price and 24h % deltas.
 */
export function buildPrimaryDirect(coins: string[], tmap: TickerMap) {
  const n = coins.length;
  const bench = newGrid<number | null>(n, null);
  const delta = newGrid<number | null>(n, null);
  const pct   = newGrid<number | null>(n, null);

  const priceUSDT: Record<string, number | null> = {};
  const pctUSDT:   Record<string, number | null> = {};
  const dltUSDT:   Record<string, number | null> = {};

  // Extract USDT anchors
  for (const c of coins) {
    const t = tmap[symUsdt(c)];
    const p = t?.weightedAvgPrice ?? t?.lastPrice;
    const pctp = t?.priceChangePercent;

    const last = num(p);
    const q    = num(pctp);

    priceUSDT[c] = Number.isFinite(last) ? last : null;
    pctUSDT[c]   = Number.isFinite(q) ? q : null;
    dltUSDT[c]   = (Number.isFinite(last) && Number.isFinite(q)) ? last * (q / 100) : null;
  }

  // Pairwise fill
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const A = coins[i]!, B = coins[j]!;
      const pA = priceUSDT[A], pB = priceUSDT[B];
      const qA = pctUSDT[A],   qB = pctUSDT[B];
      const dA = dltUSDT[A],   dB = dltUSDT[B];

      // benchmark ~ price ratio A/B via USDT anchor
      bench[i][j] = (pA != null && pB != null && pB !== 0) ? (pA / pB) : null;

      // pct24h ~ (pctA - pctB)/100 (unitless)
      pct[i][j] = (qA != null && qB != null) ? ((qA - qB) / 100) : null;

      // delta — simple linearized differential:
      //   delta ≈ (dA / pB) - (pA / pB) * (dB / pB)
      if (pB != null && pB !== 0 && dA != null && dB != null && pA != null) {
        const term1 = dA / pB;
        const term2 = (pA / pB) * (dB / pB);
        delta[i][j] = term1 - term2;
      } else {
        delta[i][j] = null;
      }
    }
  }

  return {
    benchmark: invertGrid(bench),
    delta    : antisymmetrize(delta),
    pct24h   : antisymmetrize(pct),
  };
}
