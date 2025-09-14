// src/app/api/preview/binance/route.ts
import { NextResponse } from "next/server";
import { getAll as getSettings } from "@/lib/settings/server";

export const dynamic = "force-dynamic";

/* ───────────────────── Optional provider delegation (server-only) ─────────────────────
   Implement later in src/lib/dynamics.gateway.server.ts:

   export async function getPreviewSymbolsProvider(args?: { coins?: string[] }) {
     // return { ok:true, symbols:string[] }  // uppercase, unique
   }
--------------------------------------------------------------------------------------- */
async function tryGatewayProvider(argCoins?: string[]) {
  try {
    const gw = await import("@/lib/dynamics.gateway.server");
    const fn = (gw as any)?.getPreviewSymbolsProvider as
      | ((a?: { coins?: string[] }) => Promise<any>)
      | undefined;
    if (typeof fn === "function") {
      const payload = await fn(argCoins?.length ? { coins: argCoins } : undefined);
      if (payload && typeof payload === "object") return payload;
    }
  } catch {
    /* noop → fallback to local logic */
  }
  return null;
}

/* ────────────────────────────── helpers ────────────────────────────── */
const norm = (s: string) => String(s || "").trim().toUpperCase();

function parseCoinsQuery(url: URL): string[] | null {
  const raw = url.searchParams.get("coins");
  if (!raw) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw.split(",")) {
    const u = norm(t);
    if (u && !seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out.length ? out : null;
}

function coinsFallbackFromSettingsOrEnv(settings?: any): string[] {
  const fromSettings: string[] = (settings?.coinUniverse ?? []).map(norm).filter(Boolean);
  if (fromSettings.length) return fromSettings;
  const env = process.env.NEXT_PUBLIC_COINS ?? "BTC,ETH,BNB,SOL,ADA,XRP,PEPE,USDT";
  return env.split(",").map(norm).filter(Boolean);
}

function symbolsFromCoins(coins: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < coins.length; i++) {
    for (let j = 0; j < coins.length; j++) {
      if (i === j) continue;
      out.push(`${coins[i]}${coins[j]}`.toUpperCase());
    }
  }
  return Array.from(new Set(out));
}

async function verifyWithBinance(candidateSymbols: string[], chunkSize = 160): Promise<string[]> {
  const ok: string[] = [];
  for (let i = 0; i < candidateSymbols.length; i += chunkSize) {
    const batch = candidateSymbols.slice(i, i + chunkSize);
    try {
      const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(
        JSON.stringify(batch)
      )}`;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) continue;
      const arr = (await r.json()) as Array<{ symbol?: string }>;
      for (const t of arr ?? []) if (t?.symbol) ok.push(String(t.symbol).toUpperCase());
      // tiny backoff to be gentle
      await new Promise((res) => setTimeout(res, 30));
    } catch {
      // ignore this chunk; continue with next
    }
  }
  return Array.from(new Set(ok));
}

/* ───────────────────────────────── GET ─────────────────────────────────
   Usage: /api/preview/binance?coins=BTC,ETH,BNB
   If `coins` is omitted, falls back to Settings.coinUniverse → ENV.
----------------------------------------------------------------------- */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const settings = await getSettings().catch(() => null);

    const coinsFromQuery = parseCoinsQuery(url);
    const coins = (coinsFromQuery ?? coinsFallbackFromSettingsOrEnv(settings)).map(norm).filter(Boolean);

    // 0) Try server provider (non-HTTP)
    const provider = await tryGatewayProvider(coins);
    if (provider) {
      return NextResponse.json(provider, { headers: { "Cache-Control": "no-store" }, status: 200 });
    }

    if (!coins.length) return NextResponse.json({ ok: true, symbols: [] }, { headers: { "Cache-Control": "no-store" } });

    const candidates = symbolsFromCoins(coins);
    const symbols = await verifyWithBinance(candidates);
    return NextResponse.json({ ok: true, symbols }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

/* ──────────────────────────────── POST ────────────────────────────────
   Body: { coins: string[] }
   Mirrors your original behavior; convenient for programmatic calls.
----------------------------------------------------------------------- */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { coins?: string[] };
    const coins = Array.isArray(body?.coins) ? body!.coins.map(norm).filter(Boolean) : [];

    // 0) Try server provider (non-HTTP)
    const provider = await tryGatewayProvider(coins);
    if (provider) {
      return NextResponse.json(provider, { headers: { "Cache-Control": "no-store" }, status: 200 });
    }

    if (!coins.length) return NextResponse.json({ ok: true, symbols: [] }, { headers: { "Cache-Control": "no-store" } });

    const candidates = symbolsFromCoins(coins);
    const symbols = await verifyWithBinance(candidates);
    return NextResponse.json({ ok: true, symbols }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
