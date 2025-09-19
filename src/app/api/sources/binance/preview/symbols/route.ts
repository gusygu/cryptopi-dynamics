import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function queryExchangeInfoBatch(symbols: string[]): Promise<string[]> {
  if (!symbols.length) return [];
  const url = `https://api.binance.com/api/v3/exchangeInfo?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const found: string[] = [];
    for (const s of symbols) {
      const u = `https://api.binance.com/api/v3/exchangeInfo?symbol=${s}`;
      const r = await fetch(u, { cache: "no-store" });
      if (!r.ok) continue;
      const j = await r.json().catch(() => null);
      if (j && Array.isArray(j.symbols) && j.symbols[0]?.symbol === s) found.push(s);
      else if (j && j.symbol === s) found.push(s);
    }
    return found;
  }
  const json = await res.json().catch(() => null);
  const list: string[] = Array.isArray(json?.symbols)
    ? json.symbols.map((x: any) => String(x.symbol))
    : [];
  return list;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const input: string[] = Array.isArray(body?.symbols) ? body.symbols : [];
    if (!input.length) {
      return NextResponse.json({ ok: true, symbols: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const syms = Array.from(new Set(input.map((s) => String(s).trim().toUpperCase()).filter(Boolean)));
    const CHUNK = 80;
    const batches: string[][] = [];
    for (let i = 0; i < syms.length; i += CHUNK) batches.push(syms.slice(i, i + CHUNK));

    let found: string[] = [];
    for (const b of batches) {
      const got = await queryExchangeInfoBatch(b);
      if (got?.length) found = found.concat(got);
    }
    found = Array.from(new Set(found));

    return NextResponse.json({ ok: true, symbols: found }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}