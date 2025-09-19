// src/core/frozen.ts
import { getSettingsServer } from "@/lib/settings/server";

const asCoins = (list: any): string[] =>
  Array.isArray(list) ? Array.from(new Set(list.map((x:any)=>String(x).toUpperCase()).filter(Boolean))) : [];

export async function getFrozenSetFromMatricesLatest(appSessionId: string, cycleTs: number) {
  let coins: string[] = [];
  try {
    const s = await getSettingsServer().catch(() => null as any);
    coins = asCoins(s?.coinUniverse);
  } catch {}
  if (!coins.length && process.env.NEXT_PUBLIC_COINS) {
    coins = asCoins(String(process.env.NEXT_PUBLIC_COINS).split(","));
  }
  if (!coins.length) coins = ["BTC","ETH","BNB","SOL","ADA","DOGE","USDT","PEPE","BRL"];

  const base = process.env.INTERNAL_BASE_URL || "http://localhost:3000";
  const url =
    `${base}/api/matrices/latest?coins=${encodeURIComponent(coins.join(","))}` +
    `&appSessionId=${encodeURIComponent(appSessionId)}` +
    `&cycleTs=${cycleTs}&t=${Date.now()}`;

  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return new Set<string>();
  const j = await r.json();

  const coinsResp: string[] = asCoins(j?.coins);
  const grid: boolean[][] | undefined =
    Array.isArray(j?.flags?.id_pct) ? j.flags.id_pct as boolean[][] :
    j?.flags?.id_pct?.frozen;

  if (!coinsResp.length || !grid) return new Set<string>();

  const set = new Set<string>();
  for (let i=0;i<coinsResp.length;i++) {
    for (let jdx=0;jdx<coinsResp.length;jdx++) {
      if (grid[i]?.[jdx]) set.add(`${coinsResp[i]}|${coinsResp[jdx]}`);
    }
  }
  return set;
}
