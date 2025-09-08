// app/api/matrices/at/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getNearestTsAtOrBefore, getSnapshotByType, getPrevValue } from '@/core/db';

export async function GET(req: NextRequest) {
  const coins = (process.env.COINS ?? 'BTC,ETH,BNB,SOL,ADA,XRP,DOGE,USDT').split(',').map(s=>s.trim().toUpperCase());
  const types = ['benchmark','delta','pct24h','id_pct','pct_drv'] as const;

  const url = new URL(req.url);
  const tsStr = url.searchParams.get('ts');
  const tsReq = tsStr ? Number(tsStr) : NaN;

  const result: any = { coins, ts: {}, matrices: {}, flags: {} };

  for (const t of types) {
    const ts = Number.isFinite(tsReq) ? await getNearestTsAtOrBefore(t, tsReq) : null;
    result.ts[t] = ts;
    if (!ts) { result.matrices[t] = null; result.flags[t] = null; continue; }

    const snapshot = await getSnapshotByType(t, ts, coins);
    const grid = Array.from({length: coins.length},()=>Array(coins.length).fill(null as number|null));
    const frozen = Array.from({length: coins.length},()=>Array(coins.length).fill(false));

    const key = (a:string,b:string)=>`${a}|${b}`;
    const map = new Map<string, number>();
    for (const r of snapshot) map.set(key(r.base, r.quote), r.value);

    for (let i=0;i<coins.length;i++){
      for (let j=0;j<coins.length;j++){
        if (i===j) { grid[i][j]=null; frozen[i][j]=false; continue; }
        const A=coins[i], B=coins[j];
        const v = map.get(key(A,B)) ?? null;
        grid[i][j] = v;
        if (v == null) continue;
        const prev = await getPrevValue(t, A, B, ts);
        frozen[i][j] = (prev != null && Number.isFinite(prev) && prev === v);
      }
    }

    result.matrices[t] = grid;
    result.flags[t] = { frozen };
  }

  return NextResponse.json({ ok: true, ...result });
}
