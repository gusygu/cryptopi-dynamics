// app/api/preview/symbols/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs"; // avoid edge for external fetches

type AnyObj = Record<string, any>;

function toUpperSymbols(maybe: unknown): string[] {
  const out: string[] = [];
  const push = (s: string) => s && out.push(String(s).replace("/", "").toUpperCase());
  if (Array.isArray(maybe)) {
    for (const v of maybe) {
      if (!v) continue;
      if (typeof v === "string") push(v);
      else if (typeof v === "object") {
        const o = v as AnyObj;
        const sym =
          o.symbol ??
          (o.base && o.quote && `${o.base}${o.quote}`) ??
          (o.from && o.to && `${o.from}${o.to}`);
        if (sym) push(sym);
      }
    }
  }
  return Array.from(new Set(out));
}

function symbolsFromCoins(coins: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < coins.length; i++) {
    for (let j = 0; j < coins.length; j++) {
      if (i === j) continue;
      out.push(`${coins[i]}${coins[j]}`.toUpperCase());
    }
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const { coins } = (await req.json()) as { coins?: string[] };
    const list = (coins ?? []).map(s => String(s).trim().toUpperCase()).filter(Boolean);
    if (!list.length) return NextResponse.json({ ok: true, source: "empty", symbols: [] });

    const origin = new URL(req.url).origin;

    // 1) Try your curated local preview route
    try {
      const r = await fetch(`${origin}/api/providers/binance/preview`, { cache: "no-store" });
      if (r.ok) {
        const j: AnyObj = await r.json();
        const merged =
          toUpperSymbols(j?.symbols) ||
          toUpperSymbols(j?.pairs) ||
          toUpperSymbols(j?.preview) ||
          toUpperSymbols(j?.list) ||
          toUpperSymbols(j?.allowed) ||
          toUpperSymbols(j?.data) ||
          toUpperSymbols(j?.result);
        if (j?.ok !== false && merged.length) {
          return NextResponse.json({ ok: true, source: "local", symbols: merged });
        }
      }
    } catch { /* ignore and continue */ }

    // 2) Server-side exchangeInfo (broadest, fast, no CORS)
    try {
      const r = await fetch("https://api.binance.com/api/v3/exchangeInfo", { cache: "no-store" });
      if (r.ok) {
        const j: AnyObj = await r.json();
        const tradable = new Set<string>(
          (j?.symbols ?? [])
            .filter((s: AnyObj) => (s?.status ?? "").toUpperCase() === "TRADING")
            .map((s: AnyObj) => String(s?.symbol ?? "").toUpperCase())
        );
        const candidates = symbolsFromCoins(list);
        const found = candidates.filter(s => tradable.has(s));
        if (found.length) {
          return NextResponse.json({ ok: true, source: "exchangeInfo", symbols: Array.from(new Set(found)) });
        }
      }
    } catch { /* ignore and try 24hr below */ }

    // 3) Fallback: chunked 24hr on server
    try {
      const candidates = Array.from(new Set(symbolsFromCoins(list)));
      const ok: string[] = [];
      const chunk = 160;
      for (let i = 0; i < candidates.length; i += chunk) {
        const batch = candidates.slice(i, i + chunk);
        const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(batch))}`;
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) continue;
        const arr = (await r.json()) as Array<{ symbol?: string }>;
        for (const t of arr ?? []) if (t?.symbol) ok.push(String(t.symbol).toUpperCase());
        await new Promise(res => setTimeout(res, 25));
      }
      if (ok.length) {
        return NextResponse.json({ ok: true, source: "ticker", symbols: Array.from(new Set(ok)) });
      }
    } catch { /* fall through */ }

    return NextResponse.json({ ok: true, source: "empty", symbols: [] });
  } catch (e) {
    return NextResponse.json({ ok: false, source: "error", error: String(e) }, { status: 500 });
  }
}
