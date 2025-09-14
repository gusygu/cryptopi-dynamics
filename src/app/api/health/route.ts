// src/app/api/health/route.ts
import { NextResponse } from "next/server";
import { getSettingsServer } from "@/lib/settings/server";
import { fetchTickersForCoins, fetchOrderBooksForSymbols } from "@/sources/binance";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const now = Date.now();
  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1";
  const pick = (url.searchParams.get("coin") || "").toUpperCase();
  const depth = Number(url.searchParams.get("depth") ?? 20);

  const { coinUniverse } = await getSettingsServer();
  const coins = (coinUniverse?.length ? coinUniverse : ["BTC","ETH","BNB","SOL","ADA","USDT"])
    .filter(Boolean);
  if (!coins.includes("USDT")) coins.push("USDT");

  const [tickers, books] = await Promise.all([
    fetchTickersForCoins(coins),
    fetchOrderBooksForSymbols(coins.filter(c => c !== "USDT").map(c => `${c}USDT`), (isFinite(depth) && depth > 0 ? (depth as any) : 20)),
  ]);

  const sampleCoin = coins.includes(pick) && pick !== "USDT"
    ? pick
    : (coins.find(c => c !== "USDT") ?? "BTC");

  const echoSym = `${sampleCoin}USDT`;
  const echo = {
    coin: sampleCoin,
    ticker: tickers[sampleCoin] ?? null,
    orderbook: books[echoSym] ?? null,
  };

  const body: any = {
    ts: now,
    coins,
    symbols: coins.filter(c => c !== "USDT").map(c => `${c}USDT`),
    counts: { tickers: Object.keys(tickers).length, orderbooks: Object.keys(books).length },
    echo,
    ok: !!(echo.ticker && echo.orderbook && Number.isFinite(books[sampleCoin]?.mid)),
  };

  if (all) {
    body.echoAll = coins.map(c => ({
      coin: c,
      ticker: tickers[c] ?? null,
      orderbook: books[c] ?? null,
    }));
  }

  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

