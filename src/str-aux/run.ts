// src/strategy/aux/run.ts
"use server";

import { getAuxCoins, getAuxTiming } from "./context";
import {
  fetch24hAll,
  fetchKlinesPointsForCoin,
  usdtSymbolsFor,
  type MarketPoint,
} from "@/sources/binance"; // existing adapter  :contentReference[oaicite:6]{index=6}

type Interval = "30m" | "1h" | "3h";
type CyclePlan = Array<{ coin: string; interval: Interval; points: MarketPoint[] }>;

export type StrAuxSnapshot = {
  at: number;
  coins: string[];
  timing: {
    autoRefresh: boolean;
    autoRefreshMs: number;
    cycles: { m30: number; h1: number; h3: number };
  };
  summaries: Array<{
    coin: string;
    price: number | null;
    pct24h: number | null;
  }>;
  series: {
    m30: CyclePlan;
    h1: CyclePlan;
    h3: CyclePlan;
  };
};

function asIntervalKey(k: "m30" | "h1" | "h3"): Interval {
  return k === "m30" ? "30m" : k === "h1" ? "1h" : "3h";
}

async function fetchSeriesForCoins(
  coins: string[],
  key: "m30" | "h1" | "h3",
  cycles: number
): Promise<CyclePlan> {
  const interval = asIntervalKey(key);
  // each "cycle" pulls 1 candle; default limit = cycles (cap sane)
  const limit = Math.max(1, Math.min(512, Number(cycles || 1)));
  const results: CyclePlan = [];

  await Promise.all(
    coins
      .filter((c) => c !== "USDT")
      .map(async (coin) => {
        const points = await fetchKlinesPointsForCoin(coin, interval as any, limit); //  :contentReference[oaicite:7]{index=7}
        results.push({ coin, interval, points });
      })
  );

  return results;
}

export async function runStrAux(): Promise<StrAuxSnapshot> {
  const [coins, timing] = await Promise.all([getAuxCoins(), getAuxTiming()]);
  const tickSymbols = usdtSymbolsFor(coins); // BTC→BTCUSDT, etc.  :contentReference[oaicite:8]{index=8}
  const tickers = await fetch24hAll(tickSymbols); // bulk 24h  :contentReference[oaicite:9]{index=9}

  const bySym: Record<string, { price: number | null; pct24h: number | null }> = {};
  for (const t of tickers) {
    const p = t.weightedAvgPrice != null ? Number(t.weightedAvgPrice) : Number(t.lastPrice);
    const pct = t.priceChangePercent != null ? Number(t.priceChangePercent) : null;
    bySym[t.symbol] = {
      price: Number.isFinite(p) ? p : null,
      pct24h: Number.isFinite(pct!) ? pct! : null,
    };
  }

  const summaries = coins
    .filter((c) => c !== "USDT")
    .map((c) => {
      const s = bySym[`${c}USDT`] || { price: null, pct24h: null };
      return { coin: c, price: s.price, pct24h: s.pct24h };
    });

  const [m30, h1, h3] = await Promise.all([
    fetchSeriesForCoins(coins, "m30", timing.strCycles.m30),
    fetchSeriesForCoins(coins, "h1", timing.strCycles.h1),
    fetchSeriesForCoins(coins, "h3", timing.strCycles.h3),
  ]);

  return {
    at: Date.now(),
    coins,
    timing: {
      autoRefresh: !!timing.autoRefresh,
      autoRefreshMs: Number(timing.autoRefreshMs || 0),
      cycles: {
        m30: timing.strCycles.m30,
        h1: timing.strCycles.h1,
        h3: timing.strCycles.h3,
      },
    },
    summaries,
    series: { m30, h1, h3 },
  };
}
