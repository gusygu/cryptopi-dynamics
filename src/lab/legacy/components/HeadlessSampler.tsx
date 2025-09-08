"use client";

import { useEffect, useRef } from "react";

type Win = "30m" | "1h" | "3h";

type Props = {
  base?: string;
  quote?: string;
  symbol?: string;      // e.g. "BTCUSDT" (auto-built from base/quote if omitted)
  win?: Win;
  appSessionId?: string;
  periodMs?: number;    // sampling cadence; default 4000ms
  topK?: number;        // how many levels to sum for volume; default 5
};

export default function HeadlessSampler({
  base = "BTC",
  quote = "USDT",
  symbol,
  win = "30m",
  appSessionId = "default",
  periodMs = 4000,
  topK = 5,
}: Props) {
  const sym = (symbol || `${base}${quote}`).toUpperCase();

  // singleton interval
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;

    const snapOnce = async () => {
      try {
        // 1) depth (to infer mid + lightweight volume)
        const depthU = new URL("/api/binance/depth", window.location.origin);
        depthU.searchParams.set("symbol", sym);
        depthU.searchParams.set("limit", "100");
        const depthRes = await fetch(depthU, { cache: "no-store" });
        if (!depthRes.ok) throw new Error(`depth HTTP ${depthRes.status}`);
        const depth = await depthRes.json();
        const bids: [string, string][] = depth?.bids ?? [];
        const asks: [string, string][] = depth?.asks ?? [];
        const bestBid = bids.length ? Number(bids[0][0]) : NaN;
        const bestAsk = asks.length ? Number(asks[0][0]) : NaN;
        const mid = Number.isFinite(bestBid) && Number.isFinite(bestAsk)
          ? (bestBid + bestAsk) / 2
          : Number.isFinite(bestBid) ? bestBid : Number.isFinite(bestAsk) ? bestAsk : NaN;

        // sum topK bid+ask sizes (approx "activity" volume proxy)
        const sumTop = (xs: [string, string][]) =>
          xs.slice(0, Math.max(1, topK)).reduce((s, x) => s + Number(x?.[1] ?? 0), 0);
        const volProxy = sumTop(bids) + sumTop(asks);

        // 2) ticker24hr (for pct24h)
        const tkrU = new URL("/api/binance/ticker24hr", window.location.origin);
        tkrU.searchParams.set("symbol", sym);
        const tRes = await fetch(tkrU, { cache: "no-store" });
        if (!tRes.ok) throw new Error(`ticker HTTP ${tRes.status}`);
        const tkr = await tRes.json();
        // Binance returns priceChangePercent as string e.g. "-1.348"
        const pct24h = Number(tkr?.priceChangePercent ?? 0) / 100; // store as fraction

        const ts = Date.now();
        const point = {
          ts,
          price: Number.isFinite(mid) ? mid : Number(tkr?.lastPrice ?? tkr?.weightedAvgPrice ?? 0),
          volume: Number.isFinite(volProxy) ? volProxy : 0,
          spreadPct: (Number.isFinite(bestAsk) && Number.isFinite(bestBid) && mid > 0)
            ? (bestAsk - bestBid) / mid
            : 0,
        };

        // 3) POST ingest
        const res = await fetch("/api/auxi/ingest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            appSessionId,
            pair: { base, quote },
            window: win,
            opening: {
              benchmark: point.price, // healed server-side if 0
              pct24h,
              id_pct: point.spreadPct,
              ts,
              layoutHash: "orderbook-live-v1",
            },
            latestTs: ts,
            points: [point],
            metrics: {
              // (optional) explicit metrics override path; usually not needed
              pct24hCur: pct24h,
            },
          }),
        });
        if (!res.ok) throw new Error(`ingest HTTP ${res.status}`);
      } catch {
        // swallow for headless mode
      }
    };

    // start immediately then on interval
    snapOnce();
    if (ref.current) clearInterval(ref.current);
    ref.current = setInterval(snapOnce, Math.max(1500, periodMs));

    return () => {
      alive = false;
      if (ref.current) clearInterval(ref.current);
      ref.current = null;
    };
  }, [sym, base, quote, win, appSessionId, periodMs, topK]);

  return null;
}
