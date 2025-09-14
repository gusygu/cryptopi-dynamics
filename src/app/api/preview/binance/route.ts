// app/api/preview/binance/route.ts
import { NextResponse } from "next/server";

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
    const list = Array.isArray(coins) && coins.length ? coins : [];
    if (!list.length) return NextResponse.json({ ok: true, symbols: [] });

    const candidates = Array.from(new Set(symbolsFromCoins(list)));
    const ok: string[] = [];
    const chunk = 160;

    for (let i = 0; i < candidates.length; i += chunk) {
      const batch = candidates.slice(i, i + chunk);
      const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(
        JSON.stringify(batch)
      )}`;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) continue;
      const arr = (await r.json()) as Array<{ symbol?: string }>;
      for (const t of arr ?? []) if (t?.symbol) ok.push(String(t.symbol).toUpperCase());
      await new Promise((res) => setTimeout(res, 30)); // tiny backoff
    }

    return NextResponse.json({ ok: true, symbols: Array.from(new Set(ok)) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
