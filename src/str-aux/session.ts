// --- TYPES ---
export type Snapshot = {
  ts: number;
  price: number;
  benchPct: number;   // 100*(p/open-1)
  pctDrv: number;     // 100*(p_t/p_{t-1}-1)
  pct24h: number;     // from Binance 24h
};

export type Streams = {
  benchmark: { prev: number; cur: number; greatest: number };
  pct24h:    { prev: number; cur: number; greatest: number };
  pct_drv:   { prev: number; cur: number; greatest: number };
};

export type SymbolSession = {
  openingTs: number;
  openingPrice: number;

  // stats
  priceMin: number;
  priceMax: number;
  benchPctMin: number;
  benchPctMax: number;

  // counters
  swaps: number;
  shifts: number;

  // thresholds
  etaPct: number;      // swap hysteresis %, tiny e.g. 0.05
  epsShiftPct: number; // shift band %, e.g. 0.2
  K: number;           // consecutive cycles

  // signs
  lastBenchSign: number;

  // GFM:
  gfmRefPrice?: number;  // GFMr (anchor): moves ONLY on confirmed shift
  gfmCalcPrice?: number; // GFMc (latest calc): recalculated every tick
  gfmAnchorPrice?: number;
  
  // shift staging
  aboveCount: number;
  belowCount: number;

  // UI epoch (increments only on shift)
  uiEpoch: number;

  // snapshots (advance only on shift)
  snapPrev: Snapshot;
  snapCur: Snapshot;

  // greatest magnitudes (abs)
  greatestBenchAbs: number;
  greatestDrvAbs: number;
  greatestPct24hAbs: number;

  // diagnostics
  gfmDeltaAbsPct: number;

  lastPrice?: number;
};

// HMR-safe store
declare global {
  // eslint-disable-next-line no-var
  var __STR_AUX_SESS__: Map<string, SymbolSession> | undefined;
}
const SESS: Map<string, SymbolSession> =
  (globalThis as any).__STR_AUX_SESS__ ?? new Map();
(globalThis as any).__STR_AUX_SESS__ = SESS;

function sgn(x: number, eps = 0) {
  if (x > eps) return 1;
  if (x < -eps) return -1;
  return 0;
}

export function getOrInitSymbolSession(
  sessionId: string,
  symbol: string,
  openingPrice: number,
  nowTs: number,
  etaPct = 0.05,
  epsShiftPct = 0.2,
  K = 32
): SymbolSession {
  const key = `${sessionId}:${symbol}`;
  const cur = SESS.get(key);
  if (cur) return cur;

  const snap0: Snapshot = { ts: nowTs, price: openingPrice, benchPct: 0, pctDrv: 0, pct24h: 0 };
  const ss: SymbolSession = {
    openingTs: nowTs,
    openingPrice,

    priceMin: openingPrice,
    priceMax: openingPrice,
    benchPctMin: 0,
    benchPctMax: 0,

    swaps: 0,
    shifts: 0,

    etaPct,
    epsShiftPct,
    K,

    lastBenchSign: 0,

    gfmRefPrice: undefined,
    gfmCalcPrice: undefined,

    aboveCount: 0,
    belowCount: 0,

    uiEpoch: 0,

    snapPrev: snap0,
    snapCur: snap0,

    greatestBenchAbs: 0,
    greatestDrvAbs: 0,
    greatestPct24hAbs: 0,

    gfmDeltaAbsPct: 0,

    lastPrice: openingPrice,
  };
  SESS.set(key, ss);
  return ss;
}

/**
 * Update with latest market data + CURRENT calculated GFM (GFMc).
 * - Initializes GFMr once (first valid GFMc).
 * - Builds band around GFMr. Counts consecutive out-of-band hits.
 * - On confirmation (>=K): shift, snapshot prev/cur, re-anchor GFMr = current GFMc, uiEpoch++.
 */
export function updateSymbolSession(
  ss: SymbolSession,
  price: number,
  ts: number,
  gfmCalcPrice: number, // GFMc
  pct24hNow: number
) {
  // record current calc GFM
  if (Number.isFinite(gfmCalcPrice) && gfmCalcPrice > 0) {
    ss.gfmCalcPrice = gfmCalcPrice;
  }

  // initialize anchor GFMr once
  if (ss.gfmRefPrice === undefined && ss.gfmCalcPrice !== undefined) {
    ss.gfmRefPrice = ss.gfmCalcPrice;
  }

  // instantaneous
  const benchPct = ((price / ss.openingPrice) - 1) * 100;
  const prevPrice = ss.lastPrice ?? price;
  const pctDrv = ((price / prevPrice) - 1) * 100;
  ss.lastPrice = price;

  // stats
  ss.priceMin = Math.min(ss.priceMin, price);
  ss.priceMax = Math.max(ss.priceMax, price);
  ss.benchPctMin = Math.min(ss.benchPctMin, benchPct);
  ss.benchPctMax = Math.max(ss.benchPctMax, benchPct);

  // swaps with small hysteresis on benchPct
  const s = sgn(benchPct, ss.etaPct);
  if (s !== 0 && ss.lastBenchSign !== 0 && s !== ss.lastBenchSign) ss.swaps += 1;
  if (s !== 0) ss.lastBenchSign = s;

  // GFMΔ relative to GFMr
  if (ss.gfmRefPrice && ss.gfmRefPrice > 0) {
    ss.gfmDeltaAbsPct = Math.abs((price / ss.gfmRefPrice) - 1) * 100;
  } else {
    ss.gfmDeltaAbsPct = 0;
  }

  // shift detection around GFMr ± eps
  let justShifted = false;
  if (ss.gfmRefPrice && ss.gfmRefPrice > 0) {
    const up = ss.gfmRefPrice * (1 + ss.epsShiftPct / 100);
    const dn = ss.gfmRefPrice * (1 - ss.epsShiftPct / 100);

    if (price >= up) { ss.aboveCount++; ss.belowCount = 0; }
    else if (price <= dn) { ss.belowCount++; ss.aboveCount = 0; }
    else { ss.aboveCount = 0; ss.belowCount = 0; }

    if (ss.aboveCount >= ss.K || ss.belowCount >= ss.K) {
      // snapshot + re-anchor to CURRENT GFMc
      snapshotOnShift(ss, price, ts, benchPct, pctDrv, pct24hNow);
      if (ss.gfmCalcPrice && ss.gfmCalcPrice > 0) {
        ss.gfmRefPrice = ss.gfmCalcPrice; // GFMr ← GFMc
      }
      ss.aboveCount = 0; ss.belowCount = 0;
      ss.shifts += 1;
      ss.uiEpoch += 1;                 // UI change signal
      justShifted = true;
    }
  }

  // greatest magnitudes
  ss.greatestBenchAbs  = Math.max(ss.greatestBenchAbs,  Math.abs(benchPct));
  ss.greatestDrvAbs    = Math.max(ss.greatestDrvAbs,    Math.abs(pctDrv));
  ss.greatestPct24hAbs = Math.max(ss.greatestPct24hAbs, Math.abs(pct24hNow));

  return {
    benchPct, pctDrv, pct24h: pct24hNow,
    isShift: justShifted,
    gfmDeltaAbsPct: ss.gfmDeltaAbsPct,
    gfmRefPrice: ss.gfmRefPrice ?? null,
    gfmCalcPrice: ss.gfmCalcPrice ?? null,
    uiEpoch: ss.uiEpoch,
  };
}

function snapshotOnShift(
  ss: SymbolSession,
  price: number,
  ts: number,
  benchPct: number,
  pctDrv: number,
  pct24h: number
) {
  ss.snapPrev = ss.snapCur;
  ss.snapCur = { ts, price, benchPct, pctDrv, pct24h };
}

export function exportStreams(ss: SymbolSession): Streams {
  return {
    benchmark: { prev: ss.snapPrev.price, cur: ss.snapCur.price, greatest: ss.priceMax },
    pct24h:    { prev: ss.snapPrev.pct24h, cur: ss.snapCur.pct24h, greatest: ss.greatestPct24hAbs },
    pct_drv:   { prev: ss.snapPrev.pctDrv, cur: ss.snapCur.pctDrv, greatest: ss.greatestDrvAbs },
  };
}
