// src/core/primary.ts
import { buildPrimaryDirect } from '@/core/math/matrices';
import { assertCoins } from './cycleGuards';

export async function computePrimary(
  coins: string[],
  bridge: 'usdt'|'direct',
  tmap: Map<string, { lastPrice: string; priceChange: string; priceChangePercent: string }>
) {
  assertCoins(coins);
  // current implementation builds from direct symbols only
  const { benchmark, pct24h, delta } = buildPrimaryDirect(coins, tmap as any);
  return { benchmark, pct24h, delta };
}
