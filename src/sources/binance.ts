// Lightweight Binance REST adapter (public endpoints; no API key required)
// Designed for /api/str-aux/bins to supply:
//  - live price & 24h percent (ticker)
//  - klines (raw tuples) or MarketPoint[]
//  - orderbook depth snapshot → midprice MarketPoint for IDHR/FM

// If you need a mirror/testnet, set BINANCE_BASE in .env
const BASE = process.env.BINANCE_BASE ?? 'https://api.binance.com';

type Interval = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1d';

function u(path: string, q: Record<string, string | number | undefined> = {}) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function getJson<T = any>(path: string, q?: Record<string, any>) {
  const res = await fetch(u(path, q), { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return (await res.json()) as T;
}

const num = (x: any, d = 0) => {
  const n = typeof x === 'string' ? Number(x) : Number(x);
  return Number.isFinite(n) ? n : d;
};

export type MiniTicker24h = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string; // e.g. "-1.234"
};

export async function fetchTicker24h(symbol: string): Promise<{ price: number; pct24h: number }> {
  const j = await getJson<MiniTicker24h>('/api/v3/ticker/24hr', { symbol });
  return {
    price: num(j.lastPrice),
    pct24h: num(j.priceChangePercent),
  };
}

// --------- KLINES ---------
// Raw kline tuple as returned by Binance:
// [ openTime, open, high, low, close, volume, closeTime, quoteVol, trades, takerBase, takerQuote, ignore ]
export type RawKline = [
  number, string, string, string, string, string,
  number, string, number, string, string, string
];

export async function fetchKlines(
  symbol: string,
  interval: Interval,
  limit = 128
): Promise<RawKline[]> {
  return getJson<RawKline[]>('/api/v3/klines', { symbol, interval, limit });
}

// Convenience: convert klines → MarketPoint[]
export type MarketPoint = { ts: number; price: number; volume: number };
export async function fetchKlinesPoints(
  symbol: string,
  interval: Interval,
  limit = 128
): Promise<MarketPoint[]> {
  const arr = await fetchKlines(symbol, interval, limit);
  return arr.map(k => ({
    ts: k[0],
    price: num(k[4]),
    volume: num(k[5]),
  }));
}

// --------- ORDERBOOK (DEPTH) ---------
type DepthLevel = [string, string]; // [price, qty] as strings
export type DepthSnapshot = {
  lastUpdateId: number;
  bids: DepthLevel[];
  asks: DepthLevel[];
};

// Single snapshot from REST (best effort sample; for dense streams prefer WS)
export async function fetchOrderBook(symbol: string, limit: 5 | 10 | 20 | 50 | 100 | 500 | 1000 = 100): Promise<{
  depth: DepthSnapshot;
  ts: number;
  bestBid: number;
  bestAsk: number;
  mid: number;
  bidVol: number;
  askVol: number;
}> {
  const depth = await getJson<DepthSnapshot>('/api/v3/depth', { symbol, limit });
  const ts = Date.now();

  const bestBid = depth.bids.length ? num(depth.bids[0][0]) : NaN;
  const bestAsk = depth.asks.length ? num(depth.asks[0][0]) : NaN;
  const mid = Number.isFinite(bestBid) && Number.isFinite(bestAsk) ? (bestBid + bestAsk) / 2 : NaN;

  // Sum top-N visible volumes (base asset)
  const bidVol = depth.bids.reduce((s, [_, q]) => s + num(q), 0);
  const askVol = depth.asks.reduce((s, [_, q]) => s + num(q), 0);

  return { depth, ts, bestBid, bestAsk, mid, bidVol, askVol };
}

// One-shot MarketPoint from orderbook snapshot (mid as price; total vol as weight)
export async function fetchOrderBookPoint(
  symbol: string,
  limit: 5 | 10 | 20 | 50 | 100 | 500 | 1000 = 100
): Promise<MarketPoint> {
  const ob = await fetchOrderBook(symbol, limit);
  const vol = Number.isFinite(ob.bidVol + ob.askVol) ? ob.bidVol + ob.askVol : 0;
  const px = Number.isFinite(ob.mid) ? ob.mid : (Number.isFinite(ob.bestBid) ? ob.bestBid : ob.bestAsk);
  return {
    ts: ob.ts,
    price: num(px),
    volume: num(vol),
  };
}

// Best bid/ask (lightweight)
export async function fetchBookTicker(symbol: string): Promise<{ bidPrice: number; askPrice: number; mid: number }> {
  const j = await getJson<{ bidPrice: string; askPrice: string }>('/api/v3/ticker/bookTicker', { symbol });
  const bidPrice = num(j.bidPrice);
  const askPrice = num(j.askPrice);
  const mid = Number.isFinite(bidPrice) && Number.isFinite(askPrice) ? (bidPrice + askPrice) / 2 : NaN;
  return { bidPrice, askPrice, mid };
}

// Default aggregate export (optional)
export default {
  fetchTicker24h,
  fetchKlines,
  fetchKlinesPoints,
  fetchOrderBook,
  fetchOrderBookPoint,
  fetchBookTicker,
};
