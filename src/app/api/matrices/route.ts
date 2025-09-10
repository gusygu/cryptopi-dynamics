// src/app/api/matrices/route.ts
import { NextResponse } from "next/server";
import { getSettingsServer } from "@/lib/settings/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getSettingsServer().catch(() => null);

    // coins from Settings; fallback only if Settings is empty
    const rawCoins =
      (settings?.coinUniverse?.length ? settings.coinUniverse :
        (process.env.COINS ?? process.env.NEXT_PUBLIC_COINS ?? "BTC,ETH,BNB,SOL,ADA,XRP,PEPE,USDT")
          .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));

    // normalize + dedupe (and keep USDT if present in Settings)
    const seen = new Set<string>();
    const coins = [];
    for (const c of rawCoins) {
      const u = String(c || "").trim().toUpperCase();
      if (!u || seen.has(u)) continue;
      seen.add(u);
      coins.push(u);
    }

    // Prefer core/matricesLatest if available
    try {
      const mod: any = await import("@/core/matricesLatest");
      if (mod?.buildLatestPayload) {
        const payload = await mod.buildLatestPayload(coins);
        return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
      }
    } catch {
      // fall through to /api/matrices/latest
    }

    // Fallback: proxy to /api/matrices/latest (explicitly pass coins)
    const base =
      process.env.NEXT_PUBLIC_BASE_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
    const url = new URL("/api/matrices/latest", base);
    url.searchParams.set("k", coins.join("|"));
+   url.searchParams.set("t", String(Date.now()));
    const key = coins.join("|");
    // If you can expose a settings version, use that instead of Date.now():
    // const { version } = await getSettingsServer();
    url.searchParams.set("k", key);
    // Soft-bust intermediates when settings change quickly
    const r = await fetch(url, { cache: "no-store" });
    const j = await r.json();
    return NextResponse.json(j, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
