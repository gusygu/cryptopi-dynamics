import { NextRequest, NextResponse } from "next/server";
import { getAll as getSettings } from "@/lib/settings/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function combos(coins: string[]): string[] {
  const out: string[] = [];
  const C = coins.map((c) => c.trim().toUpperCase()).filter(Boolean);
  for (let i = 0; i < C.length; i++) {
    for (let j = 0; j < C.length; j++) {
      if (i === j) continue;
      out.push(`${C[i]}${C[j]}`);
    }
  }
  return Array.from(new Set(out));
}

function parseCoins(search: URLSearchParams, fallback: string[]): string[] {
  const raw = search.get("coins");
  if (!raw) return fallback;
  const arr = raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  return arr.length ? arr : fallback;
}

export async function GET(req: NextRequest) {
  try {
    const settings = await getSettings();
    const defCoins: string[] =
      Array.isArray((settings as any)?.coinUniverse) && (settings as any).coinUniverse.length
        ? (settings as any).coinUniverse.map((c: any) => String(c).toUpperCase())
        : ["BTC","ETH","BNB","SOL","ADA","DOGE","USDT","PEPE","BRL"];

    const coins = parseCoins(req.nextUrl.searchParams, defCoins);
    if (!coins.length) {
      return NextResponse.json({ ok: true, symbols: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const candidates = combos(coins);
    const verifyUrl = new URL("/api/sources/binance/preview/symbols", req.nextUrl.origin);
    const vr = await fetch(verifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ symbols: candidates }),
    });
    if (!vr.ok) {
      const err = await vr.text();
      return NextResponse.json({ ok: false, error: `verifier ${vr.status} ${err}` }, { status: 502 });
    }
    const vjson = await vr.json().catch(() => null);
    const verified: string[] = Array.isArray(vjson?.symbols) ? vjson.symbols : [];

    return NextResponse.json({ ok: true, symbols: verified }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}