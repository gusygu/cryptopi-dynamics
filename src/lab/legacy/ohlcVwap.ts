import { MarketPoint, OhlcBar, OhlcBundle } from "./types";

// numeric helpers
const num = (x: any, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);

/** Align timestamp to bucket start */
export function bucketStart(ts: number, bucketMs: number): number {
  return Math.floor(ts / bucketMs) * bucketMs;
}

/** Compute VWAP Σ(p*v)/Σ(v); if Σv==0, fallback to mean(price) */
export function vwapOf(points: MarketPoint[]): number {
  if (!points.length) return 0;
  let numPV = 0, denV = 0, accP = 0;
  for (const p of points) {
    const pr = num(p.price, 0);
    const v  = num(p.volume, 0);
    numPV += pr * v; denV += v; accP += pr;
  }
  if (denV > 0) return numPV / denV;
  return accP / points.length;
}

/**
 * Compute Top-N VWAP.
 * @param points series
 * @param policy 'topK' means take K highest-volume samples; 'topPct' means take top PERCENT of total volume coverage (0..1)
 * @param n if policy=='topK', n=K (integer); if 'topPct', n=fraction 0..1
 */
export function vwapTopN(points: MarketPoint[], policy: "topK" | "topPct", n: number): number {
  if (!points.length) return 0;
  const sorted = [...points].sort((a, b) => num(b.volume, 0) - num(a.volume, 0));
  let chosen: MarketPoint[] = [];
  if (policy === "topK") {
    const K = Math.max(1, Math.floor(n));
    chosen = sorted.slice(0, Math.min(K, sorted.length));
  } else {
    const frac = Math.min(1, Math.max(0, n));
    const totalV = sorted.reduce((s, p) => s + num(p.volume, 0), 0);
    if (totalV <= 0) chosen = sorted;
    else {
      let acc = 0;
      for (const p of sorted) {
        chosen.push(p);
        acc += num(p.volume, 0);
        if (acc / totalV >= frac) break;
      }
    }
  }
  return vwapOf(chosen);
}

/** Build bucketed OHLC bars and a turn summary from normalized points. */
export function toOhlc(points: MarketPoint[], bucketMs: number, topNPolicy?: { mode: "topK" | "topPct"; n: number }): OhlcBundle {
  if (!points.length) {
    return {
      bucketMs,
      bars: [],
      summary: { open: 0, high: 0, low: 0, close: 0, vwap: 0, vwapTopN: 0 },
    };
  }

  const firstTs = bucketStart(points[0].ts, bucketMs);
  const byBucket = new Map<number, MarketPoint[]>();
  for (const p of points) {
    const b = bucketStart(p.ts, bucketMs);
    const k = Math.max(b, firstTs);
    const arr = byBucket.get(k) ?? [];
    arr.push(p);
    byBucket.set(k, arr);
  }

  const bars: OhlcBar[] = [];
  for (const [t0, arr] of Array.from(byBucket.entries()).sort((a, b) => a[0] - b[0])) {
    let open = num(arr[0]?.price, 0);
    let close = num(arr[arr.length - 1]?.price, open);
    let high = -Infinity, low = +Infinity, vol = 0;
    for (const p of arr) {
      const pr = num(p.price, 0);
      high = Math.max(high, pr);
      low  = Math.min(low, pr);
      vol += num(p.volume, 0);
    }
    if (!Number.isFinite(high)) high = open;
    if (!Number.isFinite(low))  low  = open;

    const vwap = vwapOf(arr);
    const vwapN = topNPolicy ? vwapTopN(arr, topNPolicy.mode, topNPolicy.n) : undefined;

    bars.push({
      t0, t1: t0 + bucketMs,
      open, high, low, close,
      volume: vol,
      trades: arr.length,
      vwap, vwapTopN: vwapN,
    });
  }

  // turn summary from all points
  const open = num(points[0]?.price, 0);
  const close = num(points[points.length - 1]?.price, open);
  const high = Math.max(...points.map(p => num(p.price, 0)));
  const low  = Math.min(...points.map(p => num(p.price, 0)));
  const vwap = vwapOf(points);
  const vwapN = topNPolicy ? vwapTopN(points, topNPolicy.mode, topNPolicy.n) : undefined;

  return { bucketMs, bars, summary: { open, high, low, close, vwap, vwapTopN: vwapN } };
}
