// src/lib/coins/resolve.ts
import { getAll as getSettings } from "@/lib/settings/server";

/** Normalize -> UPPER -> dedupe while preserving first occurrence order. Ensure USDT once. */
function normalize(list: string[] | undefined | null): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    const t = String(s || "").trim().toUpperCase();
    if (!t) continue;
    if (!seen.has(t)) { seen.add(t); out.push(t); }
  }
  if (!seen.has("USDT")) out.push("USDT");
  return out;
}

function envFallback(): string[] {
  return normalize(
    (process.env.NEXT_PUBLIC_COINS ?? process.env.COINS ?? "BTC,ETH,BNB,SOL,ADA,XRP,PEPE,USDT")
      .split(",")
  );
}

const ORIGIN =
  process.env.NEXT_PUBLIC_BASE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

/** Returns a Set of valid spot symbols advertised by our /api/providers/binance/preview?spot=1 */
async function getBinanceSpotSet(): Promise<Set<string>> {
  try {
    const res = await fetch(`${ORIGIN}/api/providers/binance/preview?spot=1`, { cache: "no-store" });
    const j = (await res.json().catch(() => ({}))) as { symbols?: string[] };
    return new Set((j.symbols ?? []).map(s => String(s).trim().toUpperCase()));
  } catch {
    return new Set<string>();
  }
}

/**
 * Resolve coins for a request, in order:
 *  1) ?coins= (comma sep) if present
 *  2) settings.coinUniverse (cookie-backed)
 *  3) env fallback
 * Always: normalize UPPER, dedupe, ensure USDT once.
 * Optionally: filter to Binance preview “spot” set.
 */
export async function resolveCoins(url: URL, opts?: { spotOnly?: boolean }): Promise<string[]> {
  // 1) query param
  const p = url.searchParams.get("coins");
  const fromQuery = p ? normalize(p.split(",")) : [];
  if (fromQuery.length) {
    if (opts?.spotOnly) {
      const spot = await getBinanceSpotSet();
      return fromQuery.filter((c) => spot.has(c) || c === "USDT");
    }
    return fromQuery;
  }

  // 2) settings (server truth)
  const s = await getSettings(); // cookie → sanitized settings
  const fromSettings = normalize(s?.coinUniverse);

  const base = fromSettings.length ? fromSettings : envFallback();

  if (opts?.spotOnly) {
    const spot = await getBinanceSpotSet();
    return base.filter((c) => spot.has(c) || c === "USDT");
  }
  return base;
}
