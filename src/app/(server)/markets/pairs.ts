// src/server/markets/pairs.ts
export function buildPairs(universe: string[], quote: string) {
  // Build A/B table: for every base in universe, build base/other and base/quote when available
  const bases = universe.filter(c => c !== quote);
  const all: string[] = [];
  for (const a of bases) {
    for (const b of universe) {
      if (a === b) continue;
      // Prefer direct market A/B; else approximate via quote (A/quote & B/quote)
      // Symbol formats vary: "ETHBTC" or "ETHUSDT"
      all.push(`${a}${b}`); // direct; we'll handle 404s upstream and fallback via quote
    }
    all.push(`${a}${quote}`); // ensure A/quote exists for fallback math
  }
  // de-dup
  return Array.from(new Set(all));
}