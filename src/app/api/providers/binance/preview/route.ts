// src/app/api/providers/binance/preview/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";       // always hit API (we still do in-memory caching)
export const revalidate = 0;

type ExSymbol = {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  isSpotTradingAllowed?: boolean;
};

type ExInfo = { symbols: ExSymbol[] };

const BINANCE_EXCHANGEINFO = "https://api.binance.com/api/v3/exchangeInfo";

// very small in-memory cache (node process)
const mem = globalThis as unknown as {
  __binance_preview__?: { at: number; coins: string[] };
};

const MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

function isLevToken(sym: string) {
  // filter out obvious leveraged tokens
  return /(?:UP|DOWN|BULL|BEAR)$/.test(sym) || /\d+[LS]$/.test(sym);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const quote = (searchParams.get("quote") || "").toUpperCase(); // optional: restrict assets by quote (e.g., USDT)
  const onlySpot = (searchParams.get("spot") ?? "1") !== "0";    // default: only spot TRADING

  // serve from cache if fresh
  const cached = mem.__binance_preview__;
  if (cached && Date.now() - cached.at < MAX_AGE_MS) {
    return NextResponse.json({
      coins: cached.coins,
      count: cached.coins.length,
      source: "binance",
      cached: true,
      updatedAt: new Date(cached.at).toISOString(),
    });
  }

  // fetch exchange info
  const res = await fetch(BINANCE_EXCHANGEINFO, { cache: "no-store" });
  if (!res.ok) {
    // fallback to last cache if available
    if (cached) {
      return NextResponse.json({
        coins: cached.coins,
        count: cached.coins.length,
        source: "binance",
        cached: true,
        updatedAt: new Date(cached.at).toISOString(),
        note: "served from cache due to upstream error",
      });
    }
    return NextResponse.json({ coins: [], count: 0, source: "binance", error: res.statusText }, { status: 502 });
  }

  const data = (await res.json()) as ExInfo;
  const symbols = Array.isArray(data?.symbols) ? data.symbols : [];

  const set = new Set<string>();

  for (const s of symbols) {
    const okStatus = s.status === "TRADING";
    const okSpot = !onlySpot || !!s.isSpotTradingAllowed;
    if (!okStatus || !okSpot) continue;

    const base = String(s.baseAsset || "").toUpperCase();
    const quoteAsset = String(s.quoteAsset || "").toUpperCase();

    if (base && !isLevToken(base)) set.add(base);
    if (quoteAsset && !isLevToken(quoteAsset)) set.add(quoteAsset);

    // optional restriction by quote (e.g., only assets that trade vs USDT)
    if (quote && quoteAsset === quote) {
      if (base && !isLevToken(base)) set.add(base);
    }
  }

  // clean up: keep A-Z0-9 only, 2..10 chars
  const coins = Array.from(set)
    .map((x) => x.replace(/[^A-Z0-9]/g, ""))
    .filter((x) => x.length >= 2 && x.length <= 10)
    .sort((a, b) => a.localeCompare(b));

  // write cache
  mem.__binance_preview__ = { at: Date.now(), coins };

  return NextResponse.json({
    coins,
    count: coins.length,
    source: "binance",
    cached: false,
    updatedAt: new Date().toISOString(),
  });
}
