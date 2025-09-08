// central in-memory store for aux-strategy windows (dev-only)
import type {
  BucketKey,
  MarketPoint,
  OpeningExact,
  StrategyAuxResult,
  StrategyAuxInput,
} from "@/lab/legacy";
import { buildStrategyAux } from "@/lab/legacy";

type Key = `${string}:${string}${string}:${BucketKey}`; // appSessionId:BASEQUOTE:win

const nowMs = () => Date.now();
const num = (x: any, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);
const upper = (s: any) => String(s || "").toUpperCase();

function msForWin(win: BucketKey): number {
  if (win === "1h") return 60 * 60 * 1000;
  if (win === "3h") return 3 * 60 * 60 * 1000;
  return 30 * 60 * 1000; // 30m
}

export type AuxIngestPayload = {
  appSessionId?: string;
  pair: { base: string; quote: string };
  window?: BucketKey;
  opening?: Partial<OpeningExact>;
  latestTs?: number;
  points?: Array<Partial<MarketPoint>>;
  metrics?: StrategyAuxInput["metrics"];
};

type Slot = {
  key: Key;
  base: string;
  quote: string;
  win: BucketKey;
  opening: OpeningExact;
  points: MarketPoint[];     // trimmed to window span
  last: StrategyAuxResult | null;
  prev: StrategyAuxResult | null;
  latestTs: number;
};

const SLOTS = new Map<Key, Slot>();
const STATS = {
  startMs: nowMs(),
  ingestsOk: 0,
  ingestsFailed: 0,
  windowsAccepted: 0,
  samplesIgnored: 0,
  lastBySymbol: new Map<string, { latestTs: number; window: BucketKey }>(),
};

function keyOf(appSessionId: string, base: string, quote: string, win: BucketKey): Key {
  return `${appSessionId}:${upper(base)}${upper(quote)}:${win}`;
}

function healOpening(
  given: Partial<OpeningExact> | undefined,
  fallbackPrice: number
): OpeningExact {
  const ts = Number(given?.ts || nowMs());
  return {
    benchmark: num(given?.benchmark, fallbackPrice),
    pct24h: num(given?.pct24h, 0),
    id_pct: num(given?.id_pct, 0),
    ts,
    layoutHash: String(given?.layoutHash || "orderbook-live-v1"),
  };
}

function coercePoint(p: Partial<MarketPoint>): MarketPoint | null {
  const ts = Number(p.ts);
  const price = Number(p.price);
  const volume = Number(p.volume);
  if (!Number.isFinite(ts)) return null;
  if (!Number.isFinite(price) || !Number.isFinite(volume)) return null; // drop light/invalid
  return {
    ts,
    price,
    volume,
    spreadPct: Number.isFinite(Number(p.spreadPct)) ? Number(p.spreadPct) : undefined,
    vwapTopN: Number.isFinite(Number(p.vwapTopN)) ? Number(p.vwapTopN) : undefined,
  };
}

export function ingest(payload: AuxIngestPayload) {
  const appSessionId = String(payload.appSessionId || "default");
  const base = upper(payload.pair?.base);
  const quote = upper(payload.pair?.quote);
  const win: BucketKey = (payload.window as BucketKey) || "30m";
  const k = keyOf(appSessionId, base, quote, win);

  const pointsIn = (payload.points || [])
    .map(coercePoint)
    .filter((p): p is MarketPoint => !!p);

  if (!SLOTS.has(k)) {
    const firstPrice = pointsIn.length ? pointsIn[0].price : 0;
    const opening = healOpening(payload.opening, firstPrice);
    SLOTS.set(k, {
      key: k,
      base, quote, win,
      opening,
      points: [],
      last: null,
      prev: null,
      latestTs: 0,
    });
  }

  const slot = SLOTS.get(k)!;
  if (!pointsIn.length) {
    STATS.samplesIgnored++;
    return { ok: true, accepted: 0, latestTs: slot.latestTs };
  }

  // append & trim to window
  const span = msForWin(win);
  const all = [...slot.points, ...pointsIn].sort((a, b) => a.ts - b.ts);
  const cutoff = nowMs() - span;
  const trimmed = all.filter(p => p.ts >= cutoff);
  slot.points = trimmed;

  // heal opening if needed
  if (!Number.isFinite(slot.opening?.benchmark) || slot.opening.benchmark === 0) {
    slot.opening = healOpening(payload.opening, trimmed[0].price);
  }

  // build aux
  const latestTs = Number(payload.latestTs || trimmed[trimmed.length - 1]?.ts || nowMs());
  const input: StrategyAuxInput = {
    opening: slot.opening,
    points: trimmed,
    metrics: payload.metrics || {},
    latestTs,
    nShifts: 0,
    timelapseSec: Math.round(span / 1000),
    settled: true,
    prevExtrema: undefined,
  };

  const result = buildStrategyAux(input);
  slot.prev = slot.last;
  slot.last = result;
  slot.latestTs = latestTs;

  STATS.ingestsOk++;
  STATS.windowsAccepted++;
  STATS.lastBySymbol.set(`${base}${quote}`, { latestTs, window: win });

  return { ok: true, accepted: pointsIn.length, latestTs };
}

export function getCurrent(appSessionId: string, base: string, quote: string, win: BucketKey) {
  const k = keyOf(appSessionId || "default", base, quote, win);
  const slot = SLOTS.get(k);
  if (!slot) return { ok: true, cur: null, prev: null };
  return { ok: true, cur: slot.last, prev: slot.prev };
}

export function getDebug() {
  const symbols = new Set<string>();
  const windows = new Set<string>();
  for (const s of SLOTS.values()) {
    symbols.add(`${s.base}${s.quote}`);
    windows.add(`${s.base}${s.quote}:${s.win}`);
  }
  return {
    now: nowMs(),
    upSecs: Math.floor((nowMs() - STATS.startMs) / 1000),
    symbols: Array.from(symbols),
    windows: Array.from(windows),
    stats: {
      ingestsOk: STATS.ingestsOk,
      ingestsFailed: STATS.ingestsFailed,
      samplesIgnored: STATS.samplesIgnored,
      windowsAccepted: STATS.windowsAccepted,
      lastBySymbol: Object.fromEntries(
        Array.from(STATS.lastBySymbol.entries())
      ),
    },
  };
}

export function peek(appSessionId: string, base: string, quote: string, win: BucketKey, limit = 1200) {
  const k = `${appSessionId}:${String(base).toUpperCase()}${String(quote).toUpperCase()}:${win}` as Key;
  const slot = SLOTS.get(k);
  if (!slot) return { ok: true, points: [], last: null, prev: null };
  const pts = slot.points.slice(-Math.max(1, limit));
  return {
    ok: true,
    points: pts,
    last: slot.last,
    prev: slot.prev,
    meta: {
      base: slot.base, quote: slot.quote, win: slot.win,
      count: pts.length, latestTs: slot.latestTs
    }
  };
}