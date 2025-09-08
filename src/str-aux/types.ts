// === canonical core types for CryptoPi aux-strategy ===
// Core (server/shared) types added to support buildStrAux + API

// Windows used across app; alias public name to existing BucketKey for compat
export type WindowKey = "30m" | "1h" | "3h";
export type Pair = { base: string; quote: string; window: WindowKey; appSessionId?: string };
export type Point = { ts: number; price: number; volume: number };

export type Opening = {
  benchmark: number;
  pct24h: number;
  pct_drv: number;    // drift around open
  ts: number;
  layoutHash: string;
};

export type Triple = { prev: number; cur: number; greatest: number };

export type Nucleus = { binIndex: number; density: number; firstDegree: number; secondDegree: number };
export type IdhrResult = { nuclei: Nucleus[]; sampleFirstDegrees: number[]; outlierCount: number };

export type Stats = {
  zAbs: number; sigma: number; gfm: number; deltaGfm: number; shifted: boolean;
  vInner: number; vOuter: number; refGfm: number;
};

export type StrAuxDoc = {
  id: string;
  pair: Pair;
  opening: Opening;
  nuclei: Nucleus[];
  stats: Stats;
  stream: { benchmark: Triple; pct24h: Triple; pct_drv: Triple };
  updatedAt: number;
};

export type ComputePayload = {
  pair: Pair;
  opening?: Opening;
  points?: Point[];
  metrics?: {
    benchmarkPrev?: number; benchmarkCur?: number;
    pct24hPrev?: number;    pct24hCur?: number;
    idPctPrev?: number;     idPctCur?: number;
    pct_drvPrev?: number;   pct_drvCur?: number;
  } | null;
  latestTs?: number;
  refGfm?: number | null;
};

export type BucketKey = WindowKey;

export type MarketPoint = {
  ts: number;            // epoch ms
  price: number;         // normalized last price (we map from "mid")
  volume: number;        // normalized volume (depthBid+depthAsk or real vol)
  spreadPct?: number;    // optional spread% at sample time
  vwapTopN?: number;     // optional per-sample Top-N VWAP (rare)
};

export type OpeningExact = {
  benchmark: number;     // opening reference price (healed to last point if 0)
  pct24h: number;        // 24h change (choose: fraction e.g. -0.01348 or percent -1.348)
  id_pct: number;        // opening identity/spread metric
  ts: number;            // opening timestamp (ms)
  layoutHash: string;    // layout/version string
};

export type AbsQuad = { prev: number; cur: number; maxTurn: number; minTurn: number };
export type QuantQuad = { prev: number; cur: number; maxTurn: number; minTurn: number };
export type MetricBand = { abs: AbsQuad; quant: QuantQuad };

export type StrValues = {
  benchmark: MetricBand; // OHLC/VWAP-based
  pct24h:    MetricBand; // carried from opening or recomputed
  id_pct:    MetricBand; // spreadPct stats over the turn
};

export type OhlcBar = {
  t0: number; t1: number;
  open: number; high: number; low: number; close: number;
  volume: number; trades: number;
  vwap: number;           // Σ(p*v)/Σ(v) (fallback to mean if Σv==0)
  vwapTopN?: number;      // computed with Top-N selection policy
};

export type OhlcBundle = {
  bucketMs: number;
  bars: OhlcBar[];
  summary: {
    open: number; high: number; low: number; close: number; vwap: number; vwapTopN?: number;
  };
};

export type FloatingModeLite = {
  gfm: number;           // generalized floating mode signal (placeholder)
  confidence: number;    // 0..1
  inertia: number;       // 0..1
  disruption: number;    // ≥0
  zMeanAbs?: number;
  sigmaGlobal?: number;
  vInner?: number;
  vOuter?: number;
  nuclei?: Array<{ key?: { idhr?: number; ior?: number }; mu?: number; D?: number; z?: number }>;
};

export type StrategyAuxInput = {
  opening: OpeningExact;
  points: MarketPoint[];
  metrics: {
    benchmarkPrev?: number; benchmarkCur?: number;
    pct24hPrev?: number;    pct24hCur?: number;
    idPctPrev?: number;     idPctCur?: number;
  };
  latestTs: number;
  nShifts: number;
  timelapseSec: number;
  settled: boolean;
  prevExtrema?: any;
};

export type StrategyAuxResult = {
  opening: OpeningExact;
  fm: FloatingModeLite;
  strValues: StrValues;
  ohlc?: OhlcBundle;     // attached for UI/DB inspection
  tendencies?: { latestTs: number };
};

export type Snapshot = {
  price: number;      // absolute last price at snapshot
  benchPct: number;   // 24h percentage change at snapshot
  pctDrv: number;     // derived % (your pct_drv) at snapshot
  ts: number;         // unix ms timestamp
};

/**
 * Persistent per-symbol session state saved to strategy_aux.str_aux_session.
 * Keep this in sync with sessionDb.ts and your DDL.
 */
export type SymbolSession = {
  // opening & extrema within the current app session
  openingTs: number;
  openingPrice: number;
  priceMin: number;
  priceMax: number;

  // extrema of the 24h benchmark % seen during the session
  benchPctMin: number;
  benchPctMax: number;

  // regime-change counters
  swaps: number;        // sign changes of benchmark delta
  shifts: number;       // sustained deviation events (≥ K cycles over epsShiftPct)

  // thresholds / params currently in use
  etaPct: number;       // e.g. 0.0005 (0.05%) – “swap” epsilon
  epsShiftPct: number;  // e.g. 0.002 (0.2%) – “shift” epsilon
  K: number;            // sustained cycles threshold (e.g. 32)

  // “greatest absolute” helpers for quick UI badges
  greatestBenchAbs: number;
  greatestDrvAbs: number;
  greatestPct24hAbs: number;

  // rolling last price for convenience
  lastPrice: number;

  // UI epoch gate (frontend only updates on change)
  uiEpoch: number;

  // counts relative to GFMr (used by shift detection)
  aboveCount: number;
  belowCount: number;

  // GFM anchors (reference and price where anchored)
  gfmRefPrice?: number;     // current reference GFM in price space
  gfmAnchorPrice?: number;  // last anchor price (when GFMr updated)

  // last direction of benchmark (sign of delta)
  lastBenchSign: number;

  // stream snapshots (previous and current)
  snapPrev: Snapshot;
  snapCur: Snapshot;

  // |GFM - price| as percentage of GFMr (absolute)
  gfmDeltaAbsPct: number;
};