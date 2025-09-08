import { Pool } from 'pg';

export type RouteIntent = {
  appSessionId: string;
  cycleTs: number;
  routeId: string;
  legs: Array<{ from: string; to: string }>;
};

/**
 * Compiler: decide candidate routes (A->B->C ...).
 * For now, emits a placeholder route if orientational (id_pct) looks positive.
 * Replace this with your real opportunity detector.
 */
export async function compileRoutes(db: Pool, appSessionId: string, cycleTs: number): Promise<RouteIntent[]> {
  const { rows } = await db.query<{ symbol: string; id_pct: number }>(
    `select symbol, id_pct from mea_unified_refs where cycle_ts = $1`,
    [cycleTs]
  );

  const bullish = rows.filter(r => (r.id_pct ?? 0) > 0).map(r => r.symbol);
  if (bullish.length < 2) return [];

  // toy example: chain two bullish symbols via USDT bridge
  const s1 = bullish[0], s2 = bullish[1];
  return [{
    appSessionId, cycleTs,
    routeId: `rt-${cycleTs}-${s1}-${s2}`,
    legs: [
      { from: s1, to: 'USDT' },
      { from: 'USDT', to: s2 },
    ],
  }];
}
