// src/core/cycleGuards.ts
export function assertCoins(universe: string[]) {
  if (!Array.isArray(universe) || universe.length !== 8) {
    throw new Error(`COINS must list exactly 8 tickers; got ${universe?.length}`);
  }
  const dup = new Set<string>();
  for (const c of universe) {
    if (!/^[A-Z0-9]{2,12}$/.test(c)) throw new Error(`Invalid coin code: ${c}`);
    if (dup.has(c)) throw new Error(`Duplicate coin in COINS: ${c}`);
    dup.add(c);
  }
  if (!dup.has('USDT')) {
    // Not mandatory, but recommended for dense bridging
    // throw new Error('COINS should include USDT for bridging mode');
  }
}
