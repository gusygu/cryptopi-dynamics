// src/app/api/settings/route.ts
import { NextResponse, NextRequest } from "next/server";
import { migrateSettings } from "@/lib/settings/schema";
import { getAll } from "@/lib/settings/server";
// 1 year
const MAX_AGE = 60 * 60 * 24 * 365;
const COOKIE = "appSettings";
// /src/app/api/settings/route.ts
function coinsFromEnv() {
  const raw = process.env.NEXT_PUBLIC_COINS ?? "BTC,ETH,BNB,SOL,ADA,DOGE,USDT,PEPE,BRL";
  return raw.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const scope = (url.searchParams.get("scope") || "").toLowerCase();
  const settings = await getAll();
  // Poller config
  if (scope === "poller") {
    const s = await getAll();
    const baseMs = Math.max(5_000, Number(s?.timing?.autoRefreshMs ?? 40_000));
    const c40 = Math.max(5, Math.round(baseMs / 1000));
    const secCycles = Math.max(1, Math.min(10, Number(s?.timing?.secondaryCycles ?? 3)));
    const c120 = Math.max(c40, c40 * secCycles);
    // env overrides (optional) if explicitly set
    const env40 = Number(process.env.NEXT_PUBLIC_POLL_40 ?? NaN);
    const env120 = Number(process.env.NEXT_PUBLIC_POLL_120 ?? NaN);
    const cycle40 = Number.isFinite(env40) ? env40 : c40;
    const cycle120 = Number.isFinite(env120) ? env120 : c120;
    return NextResponse.json(
      { poll: { cycle40, cycle120 } },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // Default settings: wallets + coin universe
  const origin = `${req.headers.get("x-forwarded-proto") || "http"}://${req.headers.get("host") || "localhost:3000"}`;
  let wallets: Record<string, number> = {};
  try {
    const r = await fetch(`${origin}/api/providers/binance/wallet`, { cache: "no-store" });
    const j = await r.json();
    wallets = j?.wallets ?? {};
  } catch {
    wallets = {};
  }

  return NextResponse.json(
    { ok: true, wallets, coinUniverse: coinsFromEnv() },
    { headers: { "Cache-Control": "no-store" } }
  );
}

  
export async function POST(req: Request) {
  try {
    const { settings } = (await req.json()) as { settings: unknown };
    const clean = migrateSettings(settings);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE, JSON.stringify(clean), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: MAX_AGE,
    });
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "invalid payload" }, { status: 400 });
  }
}

async function readCookie() {
  // We cannot read cookies here without a Request; this GET returns just for client hydration via Next
  // Actual server usage below in getSettingsServer()
  return null;
}
