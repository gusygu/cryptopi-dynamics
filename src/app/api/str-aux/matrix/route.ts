import { NextRequest, NextResponse } from "next/server";
import { fetch24hAll, mapTickerBySymbol, usdtSymbolsFor } from "@/sources/binance";
import { getAll as getSettings } from "@/lib/settings/server";
import { buildPrimaryDirect /*, buildDerived*/ } from "@/core/math/matrices";

export const dynamic = "force-dynamic";

/**
 * GET /api/str-aux/matrix?coins=BTC,ETH,BNB&fields=benchmark,pct24h[,pct_drv]
 * - Computes matrix metrics for selected coins.
 * - pct_drv still depends on previous snapshot; returns nulls until DB prev is wired.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // Prefer query coins; else fall back to Settings; else legacy default
  const coinsQuery = (searchParams.get("coins") ?? "").trim();
  const fieldsStr = (searchParams.get("fields") ?? "benchmark,pct24h").toLowerCase();
  const fields = new Set(fieldsStr.split(",").map((s) => s.trim()).filter(Boolean));

  // Resolve coin list
  const coinsFromQuery = coinsQuery
    ? coinsQuery.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : [];
  const settings = await getSettings(); // server truth
  const coinsBase = coinsFromQuery.length ? coinsFromQuery : (settings.coinUniverse ?? []);
  // ensure USDT is present once (buildPrimaryDirect expects it in the set you used before)
  const seen = new Set<string>();
  const coins: string[] = [];
  for (const c of coinsBase) {
    const u = String(c || "").toUpperCase();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    coins.push(u);
  }
  if (!seen.has("USDT")) coins.push("USDT");

  try {
    // Fetch only the required {COIN}USDT symbols
    const symbols = usdtSymbolsFor(coins);
    const rows = await fetch24hAll(symbols);
    const tmap = mapTickerBySymbol(rows);

    const base = buildPrimaryDirect(coins, tmap); // { benchmark, delta, pct24h }

    const out: Record<string, unknown> = { ok: true, ts: Date.now(), coins };

    if (fields.has("benchmark")) out.benchmark = base.benchmark;
    if (fields.has("pct24h")) out.pct24h = base.pct24h;

    // NOTE: pct_drv depends on previous snapshot (id_pct history).
    if (fields.has("pct_drv")) {
      out.pct_drv = Array.from({ length: coins.length }, () => Array(coins.length).fill(null));
    }

    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "error" }, { status: 500 });
  }
}
