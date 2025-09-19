import {
  getLatestTsForType,
  getSnapshotByType,
  getPrevSnapshotByType,
  type MatrixType,
} from "@/core/db";
import type { AppSettings } from "@/lib/settings/schema";
import type { ServerPollerSnapshot } from "@/lib/poller/server";

const TYPES = ["benchmark", "delta", "pct24h", "id_pct", "pct_drv"] as const;

type Row = { base: string; quote: string; value: number };

const EPS_ABS = Number(process.env.SIGN_EPS_ABS ?? 1e-9);
const EPS_REL = Number(process.env.SIGN_EPS_REL ?? 1e-6);

const sgnTol = (x: number, ref: number) => {
  const eps = Math.max(EPS_ABS, EPS_REL * Math.max(Math.abs(x), Math.abs(ref)));
  return x > eps ? 1 : x < -eps ? -1 : 0;
};

const UPPER = (s: string) => String(s || "").trim().toUpperCase();
const keyFor = (a: string, b: string) => `${UPPER(a)}_${UPPER(b)}`;

export type LatestBuildOptions = {
  coins: string[];
  previewSymbols?: Iterable<string> | null;
  settings?: AppSettings | null;
  poller?: ServerPollerSnapshot | null;
};

export type LatestPayload = {
  ok: boolean;
  coins: string[];
  ts: Record<MatrixType, number | null>;
  prevTs: Record<MatrixType, number | null>;
  matrices: Record<MatrixType, (number | null)[][] | null>;
  flags: Record<MatrixType, any>;
  rows: Record<MatrixType, number>;
  rings: Record<string, Record<string, "direct" | "inverse" | "none">>;
  settings?: {
    version: number;
    coinUniverse: string[];
    params: AppSettings["params"];
    timing: AppSettings["timing"];
  } | null;
  poller?: ServerPollerSnapshot | null;
};

function toPreviewSet(symbols?: Iterable<string> | null): Set<string> | null {
  if (!symbols) return null;
  const set = new Set<string>();
  for (const sym of symbols) {
    const u = UPPER(String(sym ?? ""));
    if (u) set.add(u);
  }
  return set.size ? set : null;
}

function buildRingMap(
  coins: string[],
  previewSet: Set<string> | null,
  previewGrid: number[][] | null | undefined
): Record<string, Record<string, "direct" | "inverse" | "none">> {
  const out: Record<string, Record<string, "direct" | "inverse" | "none">> = {};
  const grid = Array.isArray(previewGrid) ? previewGrid : null;
  for (let i = 0; i < coins.length; i++) {
    const row: Record<string, "direct" | "inverse" | "none"> = {};
    for (let j = 0; j < coins.length; j++) {
      if (i === j) continue;
      let label: "direct" | "inverse" | "none" = "none";
      if (previewSet) {
        const direct = previewSet.has(`${coins[i]}${coins[j]}`);
        const inverse = previewSet.has(`${coins[j]}${coins[i]}`);
        label = direct ? "direct" : inverse ? "inverse" : "none";
      } else if (grid) {
        const val = grid[i]?.[j];
        label = val === 1 ? "direct" : val === 2 ? "inverse" : "none";
      }
      row[coins[j]] = label;
    }
    out[coins[i]] = row;
  }
  return out;
}

function sanitizeSettings(settings?: AppSettings | null) {
  if (!settings) return null;
  const coins = Array.isArray(settings.coinUniverse)
    ? settings.coinUniverse.map(UPPER)
    : [];
  return {
    version: Number(settings.version ?? 0),
    coinUniverse: coins,
    params: settings.params,
    timing: settings.timing,
  };
}

export async function buildLatestPayload(opts: LatestBuildOptions): Promise<LatestPayload> {
  const coins = opts.coins.map(UPPER);
  const previewSet = toPreviewSet(opts.previewSymbols);

  const ts: Record<MatrixType, number | null> = {
    benchmark: null,
    delta: null,
    pct24h: null,
    id_pct: null,
    pct_drv: null,
  };
  const prevTs: Record<MatrixType, number | null> = {
    benchmark: null,
    delta: null,
    pct24h: null,
    id_pct: null,
    pct_drv: null,
  };
  const matrices: Record<MatrixType, (number | null)[][] | null> = {
    benchmark: null,
    delta: null,
    pct24h: null,
    id_pct: null,
    pct_drv: null,
  };
  const flags: Record<MatrixType, any> = {
    benchmark: null,
    delta: null,
    pct24h: null,
    id_pct: null,
    pct_drv: null,
  };
  const rows: Record<MatrixType, number> = {
    benchmark: 0,
    delta: 0,
    pct24h: 0,
    id_pct: 0,
    pct_drv: 0,
  };

  const curMap: Record<string, Map<string, number>> = {};
  const prvMap: Record<string, Map<string, number>> = {};

  for (const t of TYPES) {
    const latest = await getLatestTsForType(t as MatrixType);
    ts[t] = latest == null ? null : Number(latest);
    if (latest == null) {
      curMap[t] = new Map();
      prvMap[t] = new Map();
      continue;
    }
    const current = await getSnapshotByType(t as MatrixType, latest, coins) as Row[];
    const prevResult = await getPrevSnapshotByType(t as MatrixType, latest, coins);
    const previous = prevResult.rows as Row[];
    const c = new Map<string, number>();
    const p = new Map<string, number>();
    for (const r of current) c.set(keyFor(r.base, r.quote), Number(r.value));
    for (const r of previous) p.set(keyFor(r.base, r.quote), Number(r.value));
    curMap[t] = c;
    prvMap[t] = p;
    prevTs[t] = prevResult.ts ?? null;
  }

  for (const t of TYPES) {
    const tsVal = ts[t];
    if (!tsVal) {
      matrices[t] = null;
      flags[t] = null;
      continue;
    }
    const n = coins.length;
    const grid: (number | null)[][] = Array.from({ length: n }, () => Array(n).fill(null));
    const frozen = Array.from({ length: n }, () => Array(n).fill(false));
    const bridged = Array.from({ length: n }, () => Array(n).fill(false));
    const ring = Array.from({ length: n }, () => Array(n).fill(0 as 0 | 1 | 2));
    const flip = t === "pct_drv" ? Array.from({ length: n }, () => Array(n).fill(0 as -1 | 0 | 1)) : null;

    const cm = curMap[t] ?? new Map<string, number>();
    const pm = prvMap[t] ?? new Map<string, number>();
    const bm = curMap["benchmark"] ?? new Map<string, number>();
    const prevTimestamp = prevTs[t];
    const hasPrevSnapshot = prevTimestamp != null && (prevTimestamp as number) < tsVal;
    let filled = 0;

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const A = coins[i];
        const B = coins[j];
        const mapKey = keyFor(A, B);

        if (previewSet) {
          const direct = previewSet.has(`${A}${B}`);
          const inverse = previewSet.has(`${B}${A}`);
          ring[i][j] = direct ? 1 : inverse ? 2 : 0;
        } else {
          const direct = bm.has(mapKey);
          const inverse = bm.has(keyFor(B, A));
          ring[i][j] = direct ? 1 : inverse ? 2 : 0;
        }

        const cur = cm.get(mapKey);
        const prev = pm.get(mapKey);
        const value = Number.isFinite(cur as number) ? Number(cur) : null;
        grid[i][j] = value;
        if (value != null) filled += 1;

        if (hasPrevSnapshot && Number.isFinite(cur as number) && Number.isFinite(prev as number)) {
          const curNum = Number(cur);
          const prevNum = Number(prev);
          const tol = Math.max(EPS_ABS, EPS_REL * Math.max(Math.abs(curNum), Math.abs(prevNum)));
          frozen[i][j] = Math.abs(curNum - prevNum) <= tol;
        } else {
          frozen[i][j] = false;
        }

        if (flip) {
          const idNow = curMap["id_pct"]?.get(mapKey);
          const idPrev = prvMap["id_pct"]?.get(mapKey);
          if (Number.isFinite(idNow as number) && Number.isFinite(idPrev as number)) {
            const sPrev = sgnTol(idPrev as number, idNow as number);
            const sNow = sgnTol(idNow as number, idPrev as number);
            if (sPrev !== 0 && sNow !== 0 && sPrev !== sNow) {
              flip[i][j] = sNow;
            }
          }
        }
      }
    }

    matrices[t] = grid;
    flags[t] = flip ? { frozen, bridged, preview: ring, flip } : { frozen, bridged, preview: ring };
    rows[t] = filled;
  }

  const rings = buildRingMap(coins, previewSet, (flags.benchmark as any)?.preview ?? null);

  return {
    ok: true,
    coins,
    ts,
    prevTs,
    matrices,
    flags,
    rows,
    rings,
    settings: sanitizeSettings(opts.settings ?? null),
    poller: opts.poller ?? null,
  };
}

export async function buildLatestMatrices(opts: { coins: string[]; ts_ms?: number }): Promise<Record<MatrixType, Array<{ base: string; quote: string; value: number; meta?: Record<string, any> }>>> {
  const { coins } = opts;
  const tsBy: Record<MatrixType, number | null> = {
    benchmark: null,
    delta: null,
    pct24h: null,
    id_pct: null,
    pct_drv: null,
  };
  for (const t of TYPES) {
    tsBy[t as MatrixType] = await getLatestTsForType(t as MatrixType);
  }

  const out: Record<MatrixType, Array<{ base: string; quote: string; value: number; meta?: Record<string, any> }>> = {
    benchmark: [],
    delta: [],
    pct24h: [],
    id_pct: [],
    pct_drv: [],
  };

  for (const t of TYPES) {
    const ts = tsBy[t as MatrixType];
    if (!ts) continue;
    const snap = await getSnapshotByType(t as MatrixType, ts, coins);
    out[t as MatrixType] = snap.map((r) => ({
      base: UPPER(r.base),
      quote: UPPER(r.quote),
      value: Number(r.value),
    }));
  }

  return out;
}