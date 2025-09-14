// src/lib/pairs.ts
export type PairsMap = Record<string, boolean>;
const key = (a: string, b: string) => `${a}-${b}`;

/** Build a pairs-availability map "BASE-QUOTE" => true, using full preview symbols and selected coins. */
export function buildPairsMap(coins: string[], previewSymbols?: string[] | null): PairsMap {
  const out: PairsMap = {};
  const N = coins.length;
  const sym = new Set((previewSymbols ?? []).map(s => String(s || "").toUpperCase()));

  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const a = coins[i], b = coins[j];
      // consider pair available if either direction exists in preview (spot supports one side)
      const spotAB = sym.has(`${a}${b}`);
      const spotBA = sym.has(`${b}${a}`);
      out[key(a, b)] = spotAB || spotBA;
    }
  }
  return out;
}

/** Round to 2 decimals like a wallet "visible" precision */
export function round2(n?: number): number {
  if (!Number.isFinite(Number(n))) return 0;
  return Math.round(Number(n) * 100) / 100;
}

/** For pair A->B we care about having A to sell. Amber when base balance rounds to 0.00 */
export function hasBaseWallet(base: string, wallets?: Record<string, number>): boolean {
  if (!wallets) return true; // if unknown, don't block
  const bal = round2(wallets[base]);
  return bal > 0;
}
