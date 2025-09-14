// src/server/dynamics/matrices/service.ts
import { getSettingsWithVersion } from "@/app/(server)/settings/gateway";
import { buildPairs } from "@/app/(server)/markets/pairs";
import { binanceKlines } from "@/app/(server)/markets/fetch";

type Cell = { v: number; status: "ok" | "missing" | "stale" };
type Matrix = { key: string; grid: Record<string, Record<string, Cell>>; ts: number };

const memory: { version: number; ts: number; matrix: Matrix | null } = {
  version: -1, ts: 0, matrix: null
};

const TTL = 35_000; // keep slightly below autoRefreshMs

export async function getMatrices(): Promise<Matrix> {
  const { settings, version } = await getSettingsWithVersion();

  const now = Date.now();
  if (memory.matrix && memory.version === version && now - memory.ts < TTL) {
    return memory.matrix;
  }

  const universe = settings.universe;
  const quote = settings.quote;

  // Build grid keys
  const grid: Record<string, Record<string, Cell>> = {};
  for (const a of universe) {
    grid[a] = {};
    for (const b of universe) {
      if (a === b) { grid[a][b] = { v: 0, status: "ok" }; continue; }
      grid[a][b] = { v: 0, status: "missing" };
    }
  }

  // minimal sample metric: 24h % change A/B
  // Strategy: try direct market A/B; fallback via (A/quote)/(B/quote)
  async function pct24h(symbol: string): Promise<number | null> {
    try {
      const rows = await binanceKlines(symbol, "1h", 24);
      const open = Number(rows[0][1]), close = Number(rows.at(-1)[4]);
      if (!isFinite(open) || !isFinite(close)) return null;
      return (close - open) / open;
    } catch { return null; }
  }

  const aQuoteCache: Record<string, number | null> = {};
  async function ensureAQuote(a: string) {
    if (aQuoteCache[a] !== undefined) return aQuoteCache[a];
    aQuoteCache[a] = await pct24h(`${a}${quote}`);
    return aQuoteCache[a];
  }

  // fill grid
  for (const a of universe) {
    for (const b of universe) {
      if (a === b) continue;

      let val = await pct24h(`${a}${b}`);
      let status: Cell["status"] = "ok";

      if (val === null) {
        const pa = await ensureAQuote(a);
        const pb = await ensureAQuote(b);
        if (pa === null || pb === null) {
          status = "missing";
          val = 0;
        } else {
          // A/B ≈ (A/Q) / (B/Q) - 1
          val = (1 + pa) / (1 + pb) - 1;
          status = "ok";
        }
      }

      grid[a][b] = { v: val!, status };
    }
  }

  const matrix: Matrix = { key: `pct24h`, grid, ts: now };
  memory.matrix = matrix;
  memory.version = version;
  memory.ts = now;
  return matrix;
}
