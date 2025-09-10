// src/app/api/str-aux/derived/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fetch24hAll, mapTickerBySymbol, usdtSymbolsFor } from "@/sources/binance";
import { getAll as getSettings } from "@/lib/settings/server";
import { buildPrimaryDirect, buildDerived } from "@/core/math/matrices";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const coinsQuery = (searchParams.get("coins") ?? "").trim();

  // Resolve coin list from query or Settings
  const coinsFromQuery = coinsQuery
    ? coinsQuery.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : [];
  const settings = await getSettings();
  const baseCoins = coinsFromQuery.length ? coinsFromQuery : (settings.coinUniverse ?? []);
  const seen = new Set<string>();
  const coins: string[] = [];
  for (const c of baseCoins) {
    const u = String(c || "").toUpperCase();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    coins.push(u);
  }
  if (!seen.has("USDT")) coins.push("USDT");

  const ts_ms = Date.now();

  try {
    const symbols = usdtSymbolsFor(coins);
    const rows = await fetch24hAll(symbols);
    const tmap = mapTickerBySymbol(rows);
    const { benchmark } = buildPrimaryDirect(coins, tmap);

    // TODO: replace with real DB lookups
    const getPrev = async () => null;

    const { id_pct, pct_drv } = await buildDerived(coins, ts_ms, benchmark, getPrev);
    return NextResponse.json({ ok: true, ts: ts_ms, coins, id_pct, pct_drv });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "error" }, { status: 500 });
  }
}
