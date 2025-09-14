// src/sources/binance.ts
// Public REST adapter with ticker, klines and orderbook; settings-aware.

import { getAll as getSettings } from "@/lib/settings/server";

const BASE = process.env.BINANCE_BASE ?? "https://api.binance.com";
type Interval = "1m"|"3m"|"5m"|"15m"|"30m"|"1h"|"2h"|"4h"|"6h"|"8h"|"12h"|"1d";

function u(path: string, q: Record<string, string|number|undefined> = {}) {
  const url = new URL(path, BASE);
  for (const [k,v] of Object.entries(q)) if (v != null) url.searchParams.set(k, String(v));
  return url.toString();
}
async function getJson<T=any>(path: string, q?: Record<string, any>) {
  const r = await fetch(u(path, q), { cache: "no-store", next: { revalidate: 0 } });
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
  return r.json() as Promise<T>;
}
const num = (x: any, d=NaN) => { const n = Number(x); return Number.isFinite(n) ? n : d; };

// ---- 24h ticker --------------------------------------------------------------
export type Ticker24h = {
  symbol: string;
  weightedAvgPrice?: string;
  lastPrice?: string;
  priceChangePercent?: string; // percent units (e.g. "0.9397")
  priceChange?: string;        // absolute delta (same units as lastPrice)
  openPrice?: string;
};

export async function fetch24hAll(symbols: string[]): Promise<Ticker24h[]> {
  if (!symbols?.length) return [];
  const qs = new URLSearchParams({ symbols: JSON.stringify(symbols) });
  const arr = await getJson<any[]>(`/api/v3/ticker/24hr?${qs.toString()}`);
  return (Array.isArray(arr) ? arr : []).map(t => ({
    symbol: String(t.symbol),
    weightedAvgPrice: t.weightedAvgPrice,
    lastPrice: t.lastPrice,
    priceChangePercent: t.priceChangePercent,
    priceChange: t.priceChange,
    openPrice: t.openPrice,
  }));
}

export function mapTickerBySymbol(arr: Ticker24h[]): Record<string, Ticker24h> {
  const out: Record<string, Ticker24h> = {};
  for (const t of arr) out[t.symbol] = t;
  return out;
}

function normCoins(list?: string[]) {
  const set = new Set<string>(), out: string[] = [];
  for (const c of list ?? []) {
    const u = String(c||"").trim().toUpperCase();
    if (!u || set.has(u)) continue; set.add(u); out.push(u);
  }
  if (!set.has("USDT")) out.push("USDT");
  return out;
}

export async function getSettingsCoins(): Promise<string[]> {
  const s = await getSettings();
  const from = normCoins(s.coinUniverse?.length ? s.coinUniverse : []);
  return from.length ? from : normCoins(["BTC","ETH","BNB","SOL","ADA","XRP","PEPE","USDT"]);
}

export function usdtSymbolsFor(coins: string[]) {
  return coins.filter(c => c !== "USDT").map(c => `${c}USDT`);
}

// Bulk USDT view used for triangulation (kept as-is, but now types are richer).
export async function fetchTickersForCoins(coins?: string[]) {
  const uni = normCoins(coins ?? (await getSettingsCoins()));
  const by = mapTickerBySymbol(await fetch24hAll(usdtSymbolsFor(uni)));
  const out: Record<string,{ price:number; pct24h:number }> = { USDT: { price:1, pct24h:0 } };
  for (const c of uni) {
    if (c === "USDT") continue;
    const t = by[`${c}USDT`];
    const price = t?.weightedAvgPrice != null ? Number(t.weightedAvgPrice) : Number(t?.lastPrice);
    const pct = t?.priceChangePercent != null ? Number(t.priceChangePercent) : NaN;
    if (Number.isFinite(price)) out[c] = { price, pct24h: Number.isFinite(pct) ? pct : 0 };
  }
  return out;
}

export async function fetchTicker24h(symbol: string): Promise<Ticker24h> {
  return getJson<Ticker24h>("/api/v3/ticker/24hr", { symbol: symbol.toUpperCase() });
}

/** Normalized numeric helper: last, pct24h (percent units), delta (absolute) & open */
export async function fetchTicker24hNum(symbol: string): Promise<{
  symbol: string;
  last: number | null;
  pct24h: number | null;  // e.g. 0.9397
  delta: number | null;   // absolute priceChange
  open: number | null;
}> {
  const t = await fetchTicker24h(symbol);
  const last = num(t.lastPrice, NaN);
  const pct  = num(t.priceChangePercent, NaN); // percent units
  let delta  = num(t.priceChange, NaN);
  // robust open and delta if delta missing
  let open = num(t.openPrice, NaN);
  if (!Number.isFinite(open) && Number.isFinite(last) && Number.isFinite(pct)) {
    const r = pct / 100;
    open = last / (1 + r);
  }
  if (!Number.isFinite(delta) && Number.isFinite(last) && Number.isFinite(open)) {
    delta = last - open;
  }
  return {
    symbol: t.symbol,
    last: Number.isFinite(last) ? last : null,
    pct24h: Number.isFinite(pct) ? pct : null,
    delta: Number.isFinite(delta) ? delta : null,
    open: Number.isFinite(open) ? open : null,
  };
}

// ---- klines ------------------------------------------------------------------
export type RawKline = [number,string,string,string,string,string,number,string,number,string,string,string];
export async function fetchKlines(symbol: string, interval: Interval, limit=128): Promise<RawKline[]> {
  return getJson<RawKline[]>("/api/v3/klines", { symbol, interval, limit });
}

// ---- orderbook + bookTicker --------------------------------------------------
type DepthLevel = [string,string];
export type DepthSnapshot = { lastUpdateId:number; bids:DepthLevel[]; asks:DepthLevel[] };

export async function fetchOrderBook(symbol: string, limit: 5|10|20|50|100|500|1000 = 100) {
  const depth = await getJson<DepthSnapshot>("/api/v3/depth", { symbol, limit });
  const ts = Date.now();
  const bestBid = num(depth.bids[0]?.[0]);
  const bestAsk = num(depth.asks[0]?.[0]);
  const mid = Number.isFinite(bestBid) && Number.isFinite(bestAsk) ? (bestBid + bestAsk)/2 : NaN;
  const bidVol = depth.bids.reduce((s, [_,q]) => s + num(q,0), 0);
  const askVol = depth.asks.reduce((s, [_,q]) => s + num(q,0), 0);
  return { depth, ts, bestBid, bestAsk, mid, bidVol, askVol };
}

export async function fetchOrderBooksForSymbols(
  symbols: string[],
  limit: 5|10|20|50|100|500|1000 = 100
) {
  const out: Record<string,{ mid:number; bidVol:number; askVol:number }> = {};
  await Promise.all(
    (symbols ?? []).map(async (s) => {
      const sym = String(s || "").toUpperCase();
      const { mid, bidVol, askVol } = await fetchOrderBook(sym, limit);
      out[sym] = { mid, bidVol, askVol };
    })
  );
  return out;
}

export async function fetchBookTicker(symbol: string) {
  const j = await getJson<{ bidPrice:string; askPrice:string }>("/api/v3/ticker/bookTicker", { symbol });
  const bidPrice = num(j.bidPrice), askPrice = num(j.askPrice);
  const mid = Number.isFinite(bidPrice)&&Number.isFinite(askPrice) ? (bidPrice+askPrice)/2 : NaN;
  return { bidPrice, askPrice, mid };
}

// ---- convenience points (compat with str-aux) --------------------------------
export type MarketPoint = { ts: number; price: number; volume: number };

export async function fetchOrderBookPoint(symbol: string, limit: 5|10|20|50|100|500|1000 = 100): Promise<MarketPoint> {
  const { ts, mid, bidVol, askVol } = await fetchOrderBook(symbol, limit);
  const vol = (Number(bidVol)||0) + (Number(askVol)||0);
  return { ts, price: Number(mid), volume: Number(vol) };
}

export async function fetchKlinesPoints(symbol: string, interval: Interval, limit=128): Promise<MarketPoint[]> {
  const kl = await fetchKlines(symbol, interval, limit);
  return (kl ?? []).map(k => ({ ts: Number(k[0]), price: Number(k[4]), volume: Number(k[5]) }));
}

export async function fetchKlinesPointsForCoin(coin: string, interval: Interval, limit=128): Promise<MarketPoint[]> {
  const sym = `${String(coin||"").toUpperCase()}USDT`;
  return fetchKlinesPoints(sym, interval, limit);
}

export default {
  fetch24hAll, mapTickerBySymbol, fetchTickersForCoins, getSettingsCoins, usdtSymbolsFor,
  fetchKlines, fetchOrderBook, fetchOrderBooksForSymbols, fetchBookTicker,
  fetchTicker24h, fetchTicker24hNum,
  fetchOrderBookPoint, fetchKlinesPoints, fetchKlinesPointsForCoin,
};
