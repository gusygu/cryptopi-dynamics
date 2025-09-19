import { getAll as getSettings } from "@/lib/settings/server";
import { DEFAULT_SETTINGS, type AppSettings } from "@/lib/settings/schema";
import { getPollerSnapshot, type ServerPollerSnapshot } from "@/lib/poller/server";

export const DEFAULT_MATRIX_COINS = ["BTC", "ETH", "BNB", "SOL", "ADA", "DOGE", "USDT", "PEPE", "BRL"] as const;

export type MatricesCoinSource = "query" | "settings" | "default" | "override";

export type MatricesContext = {
  settings: AppSettings;
  coins: string[];
  coinSource: MatricesCoinSource;
  poller: ServerPollerSnapshot | null;
};

export function uniqUpper(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values || []) {
    const upper = String(value || "").trim().toUpperCase();
    if (!upper || seen.has(upper)) continue;
    seen.add(upper);
    out.push(upper);
  }
  if (!seen.has("USDT")) {
    seen.add("USDT");
    out.push("USDT");
  }
  return out;
}

export function coinsFromSettings(settings: AppSettings): { coins: string[]; source: MatricesCoinSource } {
  const hasUniverse = Array.isArray(settings?.coinUniverse) && settings.coinUniverse.length > 0;
  if (hasUniverse) {
    const coins = uniqUpper(settings.coinUniverse);
    return { coins, source: "settings" };
  }
  return { coins: uniqUpper(DEFAULT_MATRIX_COINS), source: "default" };
}

export function parseCoinsParam(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return uniqUpper(raw.split(","));
}

export async function loadMatricesContext(opts: { searchParams?: URLSearchParams; coinsOverride?: string[] } = {}): Promise<MatricesContext> {
  const settings = await getSettings().catch(() => DEFAULT_SETTINGS);
  const fallback = coinsFromSettings(settings);

  let coins = fallback.coins;
  let coinSource: MatricesCoinSource = fallback.source;

  if (opts.coinsOverride?.length) {
    const override = uniqUpper(opts.coinsOverride);
    if (override.length) {
      coins = override;
      coinSource = "override";
    }
  } else if (opts.searchParams) {
    const parsed = parseCoinsParam(opts.searchParams.get("coins"));
    if (parsed.length) {
      coins = parsed;
      coinSource = "query";
    }
  }

  const poller = await getPollerSnapshot().catch(() => null);

  return { settings, coins, coinSource, poller };
}