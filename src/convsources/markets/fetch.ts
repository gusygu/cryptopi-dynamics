// src/server/markets/fetch.ts
export async function binanceKlines(symbol: string, interval: string, limit = 100) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}&t=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store", next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`Binance ${symbol} ${interval} ${res.status}`);
  return res.json() as Promise<any[]>;
}