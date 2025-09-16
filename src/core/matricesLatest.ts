// src/core/matricesLatest.ts
import {
  getLatestTsForType,
  getSnapshotByType,
  getPrevSnapshotByType,
  type MatrixType,
} from "@/core/db";
import { mkey } from "@/core/math/bridge"; // if your mkey lives elsewhere, adjust
// If you don’t have bridge.mkey, inline:
function _mkey(a: string, b: string) { return `${a.toUpperCase()}_${b.toUpperCase()}`; }

const TYPES = ["benchmark", "delta", "pct24h", "id_pct", "pct_drv"] as const;
type TKey = typeof TYPES[number];

type Row = { base: string; quote: string; value: number };

// Tunable tolerances for flip detection (env optional)
const EPS_ABS = Number(process.env.SIGN_EPS_ABS ?? 1e-9);
const EPS_REL = Number(process.env.SIGN_EPS_REL ?? 1e-3); // 0.1% relative

const sgnTol = (x: number, ref: number) => {
  const eps = Math.max(EPS_ABS, EPS_REL * Math.max(Math.abs(x), Math.abs(ref)));
  return x > eps ? 1 : x < -eps ? -1 : 0;
};

type BuildOpts = {
  coins: string[];
  /** Optional preview set (e.g., from /api/preview/binance). If omitted, we infer from direct rows. */
  previewSymbols?: Set<string>;
};

export async function buildLatestPayload(opts: BuildOpts) {
  const { coins } = opts;
  const preview = opts.previewSymbols;

  const result: any = { ok: true, coins, matrices: {}, flags: {}, ts: {}, prevTs: {} };

  // latest ts per type
  for (const t of TYPES) {
    const raw = await getLatestTsForType(t as MatrixType);
    result.ts[t] = raw == null ? null : Number(raw);
  }

  // current/previous maps per type
  const curMap: Record<string, Map<string, number>> = {};
  const prvMap: Record<string, Map<string, number>> = {};

  for (const t of TYPES) {
    const ts = result.ts[t];
    if (!ts) { curMap[t] = new Map(); prvMap[t] = new Map(); continue; }
    const curr = await getSnapshotByType(t as MatrixType, ts, coins) as Row[];
    const prev = await getPrevSnapshotByType(t as MatrixType, ts, coins) as Row[];
    const c = new Map<string, number>(), p = new Map<string, number>();
    for (const r of curr) c.set(_mkey(r.base, r.quote), r.value);
    for (const r of prev) p.set(_mkey(r.base, r.quote), r.value);
    curMap[t] = c; prvMap[t] = p;
  }

  // Build matrices, with: frozen, bridged (N/A here), preview rings, and pct_drv 'flip'
  for (const t of TYPES) {
    const tsVal: number | null = result.ts[t] ?? null;
    if (!tsVal) { result.matrices[t] = null; result.flags[t] = null; result.prevTs[t] = null; continue; }

    const n = coins.length;
    const grid   = Array.from({length:n},()=>Array(n).fill(null as number|null));
    const frozen = Array.from({length:n},()=>Array(n).fill(false));
    const bridged= Array.from({length:n},()=>Array(n).fill(false));
    const ring   = Array.from({length:n},()=>Array(n).fill(0 as 0|1|2)); // 1=direct, 2=inverse-only, 0=none
    const flip   = t === "pct_drv" ? Array.from({length:n},()=>Array(n).fill(0 as -1|0|1)) : null;

    const cm = curMap[t], pm = prvMap[t];
    const bm = curMap["benchmark"] ?? new Map<string, number>();

    for (let i=0;i<n;i++){
      for (let j=0;j<n;j++){
        if (i===j) continue;
        const A=coins[i], B=coins[j];

        // ring: infer from benchmark presence (direct/inverse)
        const direct  = bm.has(_mkey(A,B));
        const inverse = bm.has(_mkey(B,A));
        ring[i][j] = direct ? 1 : (inverse ? 2 : 0);

        // current & previous
        const k = _mkey(A,B);
        const cur = cm.get(k);
        const prv = pm.get(k);
        grid[i][j] = cur ?? null;

        // frozen flags (strict equality — if you later want tolerance, adjust)
        frozen[i][j] = Number.isFinite(cur as number) && Number.isFinite(prv as number)
          ? (cur === prv)
          : false;

        // pct_drv flip: detect sign change on id_pct
        if (flip) {
          const idNow  = curMap["id_pct"]?.get(k);
          const idPrev = prvMap["id_pct"]?.get(k);
          if (Number.isFinite(idNow!) && Number.isFinite(idPrev!)) {
            const sPrev = sgnTol(idPrev!, idNow!);
            const sNow  = sgnTol(idNow!, idPrev!);
            if (sPrev !== 0 && sNow !== 0 && sPrev !== sNow) {
              flip[i][j] = sNow; // -1 => +→−, +1 => −→+
            }
          }
        }
      }
    }

    result.matrices[t] = grid;
    result.flags[t] = flip ? { frozen, bridged, preview: ring, flip } : { frozen, bridged, preview: ring };
    result.prevTs[t] = tsVal;
  }

  return result;
}

/**
 * NEW: Produce upsertable row arrays for all matrix types.
 * NOTE: This currently re-materializes rows from the latest DB snapshot.
 *       It’s a safe compile-time unblocker for pipeline/run-once. If/when you
 *       have a live-compute path (from Binance + math), replace internals here.
 */
export async function buildLatestMatrices(opts: { coins: string[]; ts_ms?: number }): Promise<Record<MatrixType, Array<{ base:string; quote:string; value:number; meta?:Record<string,any> }>>> {
  const { coins } = opts;
  // Use the freshest per-type ts
  const tsBy: Record<MatrixType, number | null> = {
    benchmark: null, delta: null, pct24h: null, id_pct: null, pct_drv: null
  };
  for (const t of TYPES) {
    tsBy[t as MatrixType] = await getLatestTsForType(t as MatrixType);
  }

  const out: Record<MatrixType, Array<{ base:string; quote:string; value:number; meta?:Record<string,any> }>> = {
    benchmark: [], delta: [], pct24h: [], id_pct: [], pct_drv: []
  };

  for (const t of TYPES) {
    const ts = tsBy[t as MatrixType];
    if (!ts) continue;
    const snap = await getSnapshotByType(t as MatrixType, ts, coins);
    out[t as MatrixType] = snap.map(r => ({
      base: r.base.toUpperCase(),
      quote: r.quote.toUpperCase(),
      value: Number(r.value),
    }));
  }
  return out;
}
