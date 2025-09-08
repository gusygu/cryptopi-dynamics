// src/core/derived.ts
import { getPrevValue } from '@/core/db';

export async function computeDerived(
  coins: string[],
  ts_ms: number,
  benchmark: number[][]
){
  const n = coins.length;
  const id_pct: number[][] = Array.from({length:n}, () => Array(n).fill(NaN));
  const pct_drv: number[][] = Array.from({length:n}, () => Array(n).fill(NaN));

  for (let i=0;i<n;i++){
    for (let j=0;j<n;j++){
      if (i===j) continue;
      const A=coins[i], B=coins[j];
      const b_new = benchmark[i][j];
      const b_old = await getPrevValue('benchmark', A, B, ts_ms);
      if (b_old == null || !Number.isFinite(b_old) || b_old === 0 || !Number.isFinite(b_new)) {
        id_pct[i][j] = NaN;
        pct_drv[i][j] = NaN;
        continue;
      }
      const idp = (b_new - b_old) / b_old;
      id_pct[i][j] = idp;

      const id_prev = await getPrevValue('id_pct', A, B, ts_ms);
      pct_drv[i][j] = (id_prev == null || !Number.isFinite(id_prev)) ? NaN : (idp - id_prev);
    }
  }
  return { id_pct, pct_drv };
}
