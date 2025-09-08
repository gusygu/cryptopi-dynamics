// app/api/matrices/latest/route.ts
import { NextResponse } from 'next/server';
import {
  getLatestTsForType,
  getSnapshotByType,
  getPrevSnapshotByType,
} from '@/core/db';

export const dynamic = 'force-dynamic';


const TYPES = ['benchmark', 'delta', 'pct24h', 'id_pct', 'pct_drv'] as const;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const appSessionId = searchParams.get('appSessionId') || 'dev-session';
    const cycleTsParam = searchParams.get('cycleTs'); // optional (kept for parity/logging)

    // coin universe (same default you already use)
    const coins = (process.env.COINS ?? 'BTC,ETH,BNB,SOL,ADA,XRP,PEPE,USDT')
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);

    const result: any = { ok: true, coins, matrices: {}, flags: {}, ts: {}, prevTs: {} };

    // 1) resolve latest ts per type (per-session if/when db supports it)
    for (const t of TYPES) {
      result.ts[t] = await getLatestTsForType(t);
    }

    // 2) compute grids + "frozen" flags (prev == curr)
    for (const t of TYPES) {
      const ts = result.ts[t];
      if (!ts) {
        result.matrices[t] = null;
        result.flags[t] = null;
        result.prevTs[t] = null;
        continue;
      }

      const curr = await getSnapshotByType(t, ts, coins);     // [{base,quote,value}]
      const prev = await getPrevSnapshotByType(t, ts, coins); // prev row per pair

      const n = coins.length;
      const grid: (number | null)[][] = Array.from({ length: n }, () => Array(n).fill(null));
      const frozen: boolean[][]       = Array.from({ length: n }, () => Array(n).fill(false));

      const key = (a: string, b: string) => `${a}|${b}`;
      const currMap = new Map<string, number>();
      const prevMap = new Map<string, number>();

      for (const r of curr) currMap.set(key(r.base, r.quote), Number(r.value));
      for (const r of prev) prevMap.set(key(r.base, r.quote), Number(r.value));

      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const A = coins[i], B = coins[j];
          const v  = currMap.get(key(A, B));
          const pv = prevMap.get(key(A, B));

          grid[i][j] = Number.isFinite(v as number) ? (v as number) : null;
          frozen[i][j] =
            Number.isFinite(pv as number) &&
            Number.isFinite(v  as number) &&
            pv === v;
        }
      }

      result.matrices[t] = grid;
      result.flags[t]    = { frozen };
      result.prevTs[t]   = ts;
    }

    console.log('[api] matrices/latest', { appSessionId, cycleTs: cycleTsParam });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[api] matrices/latest error', e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
