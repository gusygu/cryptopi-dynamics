// src/app/api/pairs/route.ts
import { NextResponse } from "next/server";
import { getAll } from "@/lib/settings/server"; // cookie → settings (server)  :contentReference[oaicite:3]{index=3}
import { buildValidPairsFromCoins } from "@/sources/binancePairs";

function normCoins(list?: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of list ?? []) {
    const u = String(c || "").trim().toUpperCase();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

export async function GET() {
  const s = await getAll();       // includes your selected coins  :contentReference[oaicite:4]{index=4}
  const coins = normCoins(s.coinUniverse ?? []);
  const pairs = await buildValidPairsFromCoins(coins);

  return NextResponse.json(
    { coins, pairs }, // pairs: [{ symbol, base, quote }, ...]
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
