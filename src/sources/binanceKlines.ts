import type { MarketPoint } from '@/str-aux/types';
const BASE = process.env.BINANCE_BASE_URL ?? 'https://api.binance.com';

export async function fetchKlines(symbol: string, interval: string, limit: number): Promise<MarketPoint[]> {
  const url = `${BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`klines ${symbol} HTTP ${r.status}`);
  const rows = await r.json() as any[];
  return rows.map(c => ({ ts: Number(c[0]), price: Number(c[4]), volume: Number(c[5]) }));
}

export async function fetchMultiKlines(symbols: string[], interval: string, limit: number) {
  const jobs = symbols.map(async s => {
    try { return [s, await fetchKlines(s, interval, limit)] as const; }
    catch { return [s, []] as const; }
  });
  const settled = await Promise.all(jobs);
  const out: Record<string, MarketPoint[]> = {};
  for (const [sym, pts] of settled) out[sym] = pts;
  return out;
}
