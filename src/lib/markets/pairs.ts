// src/lib/markets/pairs.ts
// Shared, deterministic pair helpers used by both UI and API.

export type PairAvailability = { usdt: string[]; cross: string[]; all: string[] };

export const normalizeCoin = (c: string) =>
  String(c || "").toUpperCase().replace(/[^A-Z]/g, "");

export function dedupeCoins(bases: string[]) {
  return Array.from(new Set((bases ?? []).map(normalizeCoin))).filter(Boolean);
}

export function usdtLegsFromCoins(bases: string[]) {
  const uniq = dedupeCoins(bases).filter((c) => c !== "USDT");
  return uniq.map((b) => `${b}USDT`);
}

// Ordered permutations A->B (A !== B). No verification here.
export function crossPairsFromCoins(bases: string[]) {
  const coins = dedupeCoins(bases).filter((c) => c !== "USDT");
  const out: string[] = [];
  for (let i = 0; i < coins.length; i++) {
    for (let j = 0; j < coins.length; j++) {
      if (i === j) continue;
      out.push(`${coins[i]}${coins[j]}`);
    }
  }
  return out;
}

/**
 * Async builder with optional preview verification.
 * - If `verify` is provided, we filter USDT + cross by it.
 * - If not, we return only USDT legs (no synthetic crosses on the client).
 */
export async function pairsFromSettings(
  bases: string[],
  opts?: {
    verify?: (symbols: string[]) => Promise<Set<string>>;
    preferVerifiedUsdt?: boolean; // default true
  }
): Promise<PairAvailability> {
  const preferVerifiedUsdt = opts?.preferVerifiedUsdt ?? true;

  const usdtCand = usdtLegsFromCoins(bases);
  const crossCand = crossPairsFromCoins(bases);

  if (!opts?.verify) {
    return { usdt: usdtCand, cross: [], all: usdtCand.slice() };
  }

  const verified = await opts.verify([...usdtCand, ...crossCand]);
  const has = (s: string) => verified.has(s.toUpperCase());

  const usdt =
    verified.size && preferVerifiedUsdt ? usdtCand.filter(has) : usdtCand;
  const cross = crossCand.filter(has);
  const all = Array.from(new Set([...usdt, ...cross]));
  return { usdt, cross, all };
}
