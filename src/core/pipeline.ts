// src/core/pipeline.ts
// Robust, settings-aware pipeline runner used by /api/pipeline/run-once.
// Avoid fragile named imports; optional deps are dynamically imported.

import { getSettingsServer } from "@/lib/settings/server";
import { resolveCoins } from "@/lib/coins/resolve"; // 👈 add

type Ticker24h = {
  symbol: string;
  lastPrice?: string | number;
  priceChangePercent?: string | number;
  weightedAvgPrice?: string | number;
  openPrice?: string | number;
  closeTime?: number;
};

type RunOnceOpts = {
  coins?: string[];   // optional override
  sessionId?: string; // reserved
};

/* ---------------- helpers ---------------- */

function envFallbackCoins(): string[] {
  return (process.env.NEXT_PUBLIC_COINS ??
    process.env.COINS ??
    "BTC,ETH,BNB,SOL,ADA,XRP,PEPE,USDT")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

async function tryImport<T = any>(path: string): Promise<T | null> {
  try {
    const mod = (await import(/* @vite-ignore */ path)) as T;
    return mod as T;
  } catch {
    return null;
  }
}

/** Fetch 24h tickers for given symbols (spot). Tries bulk fn; falls back to per-symbol. */
async function fetchTickers24h(symbols: string[]): Promise<Ticker24h[]> {
  const bin = await tryImport<any>("@/sources/binance");
  const out: Ticker24h[] = [];

  // Preferred bulk names across branches
  const bulk = bin?.fetch24hAll || bin?.fetchTicker24hAll || bin?.fetchTickers24h;
  if (typeof bulk === "function") {
    try {
      const res = await bulk(symbols);
      return Array.isArray(res) ? res : out;
    } catch {
      /* fall through */
    }
  }

  const per = bin?.fetchTicker24h || bin?.fetch24h;
  if (typeof per !== "function") return out;

  await Promise.all(
    symbols.map(async (s) => {
      try {
        const t = await per(s);
        if (t && t.symbol) out.push(t as Ticker24h);
      } catch {
        /* skip */
      }
    })
  );
  return out;
}

function mapBySymbol(list: Ticker24h[]): Map<string, Ticker24h> {
  const m = new Map<string, Ticker24h>();
  for (const t of list) if (t?.symbol) m.set(String(t.symbol).toUpperCase(), t);
  return m;
}

function allPairs(coins: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < coins.length; i++) {
    for (let j = 0; j < coins.length; j++) {
      if (i === j) continue;
      pairs.push([coins[i]!, coins[j]!]);
    }
  }
  return pairs;
}

/** Minimal placeholder math when core/math/matrices isn’t available. */
function computePrimaryFromTickers(a: string, b: string, tick: Map<string, Ticker24h>) {
  const ta = tick.get(`${a}USDT`) || tick.get(`USDT${a}`);
  const tb = tick.get(`${b}USDT`) || tick.get(`USDT${b}`);
  const pa = Number(ta?.priceChangePercent ?? 0) / 100;
  const pb = Number(tb?.priceChangePercent ?? 0) / 100;
  const id_pct = pa - pb;
  const delta = id_pct;
  const benchmark = Number(ta?.weightedAvgPrice ?? 0) / Math.max(1e-9, Number(tb?.weightedAvgPrice ?? 1));
  const pct24h = Number(ta?.priceChangePercent ?? 0) - Number(tb?.priceChangePercent ?? 0);
  const pct_drv = 0; // fill from timeseries in your real buildDerived
  return { id_pct, delta, benchmark, pct24h, pct_drv };
}

async function upsertIfAvailable(
  type: "id_pct" | "delta" | "benchmark" | "pct24h" | "pct_drv",
  ts: number,
  rows: Array<{ base: string; quote: string; value: number }>
) {
  const db = await tryImport<any>("@/core/db");
  if (db?.upsertMatrixRows) {
    await db.upsertMatrixRows(type, ts, rows);
  } else if (db?.upsertMatrixRows /* legacy signature with single payload */) {
    // noop; keep compatibility comment
  }
}

/* ---------------- public API ---------------- */

export async function buildAndPersistOnce(opts: RunOnceOpts = {}) {
  // 1) settings-driven coins
  const s = await getSettingsServer().catch(() => null);
  if (!opts.coins || !opts.coins.length) {
    // fake a URL just to reuse the resolver consistently
    const url = new URL("http://local.fake/run?coins=");
    opts.coins = await resolveCoins(url, { spotOnly: true });
  }
  const coins = opts.coins;
  
  // 2) fetch tickers
  const tickers = await fetchTickers24h(coins);
  const tmap = mapBySymbol(tickers);

  // 3) timestamp
  const ts_ms = Date.now();

  // 4) try real math; else placeholder
  const math = await tryImport<any>("@/core/math/matrices");
  let benchmark: number[][] = [];
  let delta: number[][] = [];
  let pct24h: number[][] = [];
  let id_pct: number[][] = [];
  let pct_drv: number[][] = [];

  if (math?.buildPrimaryDirect && math?.buildDerived) {
    // Real path
    const { buildPrimaryDirect, buildDerived } = math;
    const primary = buildPrimaryDirect(coins, tmap);
    benchmark = primary.benchmark;
    pct24h = primary.pct24h;
    delta = primary.delta;

    const db = await tryImport<any>("@/core/db");
    const prevGetter =
      db?.getPrevValue ??
      (async () => null); // fallback

    const derived = await buildDerived(
      coins,
      ts_ms,
      benchmark,
      (mt: string, base: string, quote: string, beforeTs: number) =>
        prevGetter(mt, base, quote, beforeTs)
    );
    id_pct = derived.id_pct;
    pct_drv = derived.pct_drv;
  } else {
    // Fallback path (rough)
    const n = coins.length;
    benchmark = Array.from({ length: n }, () => Array(n).fill(0));
    pct24h   = Array.from({ length: n }, () => Array(n).fill(0));
    delta    = Array.from({ length: n }, () => Array(n).fill(0));
    id_pct   = Array.from({ length: n }, () => Array(n).fill(0));
    pct_drv  = Array.from({ length: n }, () => Array(n).fill(0));
    for (const [a, b] of allPairs(coins)) {
      const i = coins.indexOf(a), j = coins.indexOf(b);
      if (i < 0 || j < 0) continue;
      const v = computePrimaryFromTickers(a, b, tmap);
      benchmark[i][j] = v.benchmark;
      pct24h[i][j]    = v.pct24h;
      delta[i][j]     = v.delta;
      id_pct[i][j]    = v.id_pct;
      pct_drv[i][j]   = v.pct_drv;
    }
  }

  // 5) write
  const types = ["benchmark", "delta", "pct24h", "id_pct", "pct_drv"] as const;
  const rowsByType: Record<(typeof types)[number], Array<{ base: string; quote: string; value: number }>> = {
    benchmark: [], delta: [], pct24h: [], id_pct: [], pct_drv: [],
  };

  for (let i = 0; i < coins.length; i++) {
    for (let j = 0; j < coins.length; j++) {
      if (i === j) continue;
      const A = coins[i]!, B = coins[j]!;
      rowsByType.benchmark.push({ base: A, quote: B, value: benchmark[i][j] ?? 0 });
      rowsByType.delta.push({ base: A, quote: B, value: delta[i][j] ?? 0 });
      rowsByType.pct24h.push({ base: A, quote: B, value: pct24h[i][j] ?? 0 });
      rowsByType.id_pct.push({ base: A, quote: B, value: id_pct[i][j] ?? 0 });
      rowsByType.pct_drv.push({ base: A, quote: B, value: pct_drv[i][j] ?? 0 });
    }
  }

  for (const t of types) await upsertIfAvailable(t, ts_ms, rowsByType[t]);

  return {
    ok: true,
    ts_ms,
    coins,
    wrote: Object.fromEntries(types.map((t) => [t, rowsByType[t].length])),
  };
}

let _timer: NodeJS.Timeout | null = null;
let _running = false;

/** Auto-refresh using settings.timing.autoRefreshMs; re-reads settings every tick. */
export function startAutoRefresh() {
  if (_timer) return false;

  const loop = async () => {
    if (_running) { _timer = setTimeout(loop, 1000); return; }
    _running = true;
    let waitMs = 40_000;
    try {
      const s = await getSettingsServer().catch(() => null);
      waitMs = Math.max(500, Number(s?.timing?.autoRefreshMs ?? 40_000));
      await buildAndPersistOnce();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[pipeline] cycle error", e);
    } finally {
      _running = false;
      _timer = setTimeout(loop, waitMs);
    }
  };

  _timer = setTimeout(loop, 0);
  // eslint-disable-next-line no-console
  console.info("[pipeline] auto-refresh started");
  return true;
}
export function stopAutoRefresh() { if (_timer) clearTimeout(_timer); _timer = null; }
export function isAutoRefreshRunning() { return _timer != null; }

// Optional alias for compatibility
export async function runOnce(opts?: RunOnceOpts) {
  return buildAndPersistOnce(opts);
}
