import { getLatestTsForType, getSnapshotByType, getPrevSnapshotByType } from '@/core/db';

const TYPES = ['benchmark','delta','pct24h','id_pct','pct_drv'] as const;

// Tunable tolerances (env optional)
const EPS_ABS = Number(process.env.SIGN_EPS_ABS ?? 1e-9);
const EPS_REL = Number(process.env.SIGN_EPS_REL ?? 1e-3); // 0.1% relative

const key = (a: string, b: string) => `${a}|${b}`;

function sgnTol(x: number, ref: number) {
  const eps = Math.max(EPS_ABS, EPS_REL * Math.max(Math.abs(x), Math.abs(ref)));
  return x > eps ? 1 : x < -eps ? -1 : 0;
}

export async function buildLatestPayload(coins: string[]) {
  const result: any = { ok: true, coins, matrices: {}, flags: {}, ts: {}, prevTs: {} };

  // latest ts per type (normalize to number)
  for (const t of TYPES) {
    const raw = await getLatestTsForType(t);
    result.ts[t] = raw == null ? null : Number(raw);
  }

  // snapshot maps
  type Row = { base: string; quote: string; value: number };
  const curMap: Record<string, Map<string, number>> = {};
  const prvMap: Record<string, Map<string, number>> = {};

  for (const t of TYPES) {
    const ts = result.ts[t];
    if (!ts) { curMap[t] = new Map(); prvMap[t] = new Map(); continue; }
    const curr = await getSnapshotByType(t, ts, coins);
    const prev = await getPrevSnapshotByType(t, ts, coins);
    const c = new Map<string, number>(), p = new Map<string, number>();
    for (const r of curr as Row[]) c.set(key(r.base, r.quote), r.value);
    for (const r of prev as Row[]) p.set(key(r.base, r.quote), r.value);
    curMap[t] = c; prvMap[t] = p;
  }

  // build grids (+ frozen everywhere; + flip only for pct_drv)
  for (const t of TYPES) {
    const ts: number | null = result.ts[t] ?? null;
    if (!ts) { result.matrices[t] = null; result.flags[t] = null; result.prevTs[t] = null; continue; }

    const n = coins.length;
    const grid   = Array.from({length:n},()=>Array(n).fill(null as number|null));
    const frozen = Array.from({length:n},()=>Array(n).fill(false));
    const flip   = t === 'pct_drv' ? Array.from({length:n},()=>Array(n).fill(0 as -1|0|1)) : null;

    const cm = curMap[t], pm = prvMap[t];

    for (let i=0;i<n;i++){
      for (let j=0;j<n;j++){
        if (i===j) continue;
        const A=coins[i], B=coins[j];
        const k = key(A,B);
        const v  = cm.get(k);
        const pv = pm.get(k);

        grid[i][j] = Number.isFinite(v!) ? v! : null;
        frozen[i][j] = Number.isFinite(v!) && Number.isFinite(pv!) && v === pv;

        if (flip) {
          // derive flip from id_pct sign change (not pct_drv sign)
          const idNow  = curMap['id_pct'].get(k);
          const idPrev = prvMap['id_pct'].get(k);
          if (Number.isFinite(idNow!) && Number.isFinite(idPrev!)) {
            const sPrev = sgnTol(idPrev!, idNow!);
            const sNow  = sgnTol(idNow!, idPrev!);
            if (sPrev !== 0 && sNow !== 0 && sPrev !== sNow) {
              // -1 => +→− (orange), +1 => −→+ (blue)
              flip[i][j] = sNow;
            }
          }
        }
      }
    }

    result.matrices[t] = grid;
    result.flags[t] = flip ? { frozen, flip } : { frozen };
    result.prevTs[t] = ts;
  }

  return result;
}
