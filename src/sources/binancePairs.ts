// src/sources/binancePairs.ts
// Discover & validate Binance trading pairs for a given coin universe.
// Uses public /api/v3/exchangeInfo endpoint (no API key).

const BASE = process.env.BINANCE_BASE ?? "https://api.binance.com";

function u(path: string, q: Record<string, string | number | undefined> = {}) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function getJson<T = any>(path: string, q?: Record<string, any>) {
  const res = await fetch(u(path, q), { cache: "no-store", next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return (await res.json()) as T;
}

// light in-memory cache (to keep network low for UIs switching panels)
let _symCacheAt = 0;
let _symbols: Array<{ symbol: string; base: string; quote: string; status: string }> | null = null;
const SYM_TTL = 60_000; // 60s

export type TradableSymbol = { symbol: string; base: string; quote: string };

export async function fetchTradableSymbols(): Promise<TradableSymbol[]> {
  const now = Date.now();
  if (_symbols && now - _symCacheAt < SYM_TTL) {
    return _symbols.filter((s) => s.status === "TRADING");
  }
  // GET /api/v3/exchangeInfo
  const info = await getJson<{ symbols: any[] }>("/api/v3/exchangeInfo");
  const arr = Array.isArray(info?.symbols) ? info.symbols : [];
  _symbols = arr.map((x) => ({
    symbol: String(x.symbol || ""),
    base: String(x.baseAsset || ""),
    quote: String(x.quoteAsset || ""),
    status: String(x.status || ""),
  }));
  _symCacheAt = now;
  return _symbols.filter((s) => s.status === "TRADING");
}

/** From a coin list, build all directionally valid pairs that Binance lists. */
export async function buildValidPairsFromCoins(coins: string[]): Promise<TradableSymbol[]> {
  const tradables = await fetchTradableSymbols();
  // build a quick lookup like "ETH|BTC" -> {symbol, base, quote}
  const map = new Map<string, TradableSymbol>();
  for (const s of tradables) map.set(`${s.base}|${s.quote}`, s);

  const seen = new Set<string>();
  const out: TradableSymbol[] = [];
  // Only emit pairs that exist on Binance *with exact direction* (base→quote)
  for (const base of coins) {
    for (const quote of coins) {
      if (!base || !quote || base === quote) continue;
      const key = `${base.toUpperCase()}|${quote.toUpperCase()}`;
      const hit = map.get(key);
      if (hit && !seen.has(hit.symbol)) {
        seen.add(hit.symbol);
        out.push({ symbol: hit.symbol, base: hit.base, quote: hit.quote });
      }
    }
  }
  return out;
}

/** Validate a requested base/quote; returns the Binance symbol or null. */
export async function validatePair(base: string, quote: string): Promise<string | null> {
  const tradables = await fetchTradableSymbols();
  const found = tradables.find(
    (s) => s.base.toUpperCase() === base.toUpperCase() && s.quote.toUpperCase() === quote.toUpperCase()
  );
  return found ? found.symbol : null;
}

/** Validate a requested symbol (e.g., "ETHBTC"); returns {base, quote} or null. */
export async function parseSymbol(symbol: string): Promise<{ base: string; quote: string } | null> {
  const tradables = await fetchTradableSymbols();
  const hit = tradables.find((s) => s.symbol.toUpperCase() === String(symbol || "").toUpperCase());
  return hit ? { base: hit.base, quote: hit.quote } : null;
}
