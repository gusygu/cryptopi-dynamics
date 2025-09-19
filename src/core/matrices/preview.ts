'use server';
const UPPER = (s: string) => String(s || "").trim().toUpperCase();

export async function fetchPreviewSymbolSet(origin: string, coins: string[]): Promise<Set<string> | null> {
  try {
    const url = new URL("/api/preview/binance", origin);
    if (coins.length) url.searchParams.set("coins", coins.join(","));
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    const symbols: string[] = Array.isArray(body?.symbols) ? body.symbols : [];
    if (!symbols.length) return null;
    const set = new Set<string>();
    for (const sym of symbols) {
      const u = UPPER(sym);
      if (u) set.add(u);
    }
    return set.size ? set : null;
  } catch {
    return null;
  }
}