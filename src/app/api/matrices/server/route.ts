import { NextRequest, NextResponse } from "next/server";
import { buildLatestPayload } from "@/core/matricesLatest";
import { loadMatricesContext } from "@/core/matrices/context";
import { fetchPreviewSymbolSet } from "@/core/matrices/preview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const ctx = await loadMatricesContext({ searchParams: req.nextUrl.searchParams });

    try {
      const previewSet = await fetchPreviewSymbolSet(req.nextUrl.origin, ctx.coins);
      const payload = await buildLatestPayload({
        coins: ctx.coins,
        previewSymbols: previewSet,
        settings: ctx.settings,
        poller: ctx.poller,
      });
      return NextResponse.json(
        { ...payload, coinSource: ctx.coinSource },
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch {
      const base =
        process.env.NEXT_PUBLIC_BASE_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : req.nextUrl.origin);
      const url = new URL("/api/matrices/latest", base);
      if (ctx.coins.length) url.searchParams.set("coins", ctx.coins.join(","));
      url.searchParams.set("t", String(Date.now()));
      const fallback = await fetch(url, { cache: "no-store" });
      const body = await fallback.json();
      return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}