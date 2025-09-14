// src/lib/availability.ts
export type BoolMap = Record<string, boolean>;
const k = (a: string, b: string) => `${a}-${b}`;

// Derive a simple availability map for rings.
// Strategy v1 (client-only):
//  - If a preview list of SYMBOLS (e.g., "ETHUSDT") exists, mark a pair BASE-QUOTE
//    available when BOTH bases exist in preview (USDT bridge present).
//  - Else, use a numeric heuristic: if benchmark[i][j] is finite & > 0, mark available.
export function deriveAvailability(
  coins: string[],
  benchmark?: number[][],
  previewSymbols?: string[] | null
): BoolMap {
  const out: BoolMap = {};
  const N = coins.length;

  const previewCoins = new Set<string>();
  if (Array.isArray(previewSymbols)) {
    previewSymbols.forEach((sym) => {
      const up = String(sym || "").toUpperCase();
      // naive extraction: coins that appear as XXXUSDT or USDTXXX
      if (up.endsWith("USDT")) previewCoins.add(up.slice(0, -4));
      if (up.startsWith("USDT")) previewCoins.add(up.slice(4));
    });
  }

  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const a = coins[i], b = coins[j];

      if (previewCoins.size > 0) {
        out[k(a, b)] = previewCoins.has(a) && previewCoins.has(b);
      } else if (benchmark && Number.isFinite(benchmark?.[i]?.[j])) {
        out[k(a, b)] = (benchmark[i][j] as number) > 0;
      } else {
        out[k(a, b)] = false;
      }
    }
  }
  return out;
}
