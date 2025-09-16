// src/core/pipeline.ts
// Settings & poller aware pipeline (ancient-compatible).
// Exposes: buildAndPersistOnce(), startAutoRefresh({ coins?, intervalMs?, immediate? }),
// stopAutoRefresh(), isAutoRefreshRunning(), getAutoRefreshState().

import { getSettingsServer } from "@/lib/settings/server";
import { resolveCoins } from "@/lib/coins/resolve";

type Ticker24h = {
  symbol: string;
  lastPrice?: string | number;
  priceChangePercent?: string | number;
  weightedAvgPrice?: string | number;
  openPrice?: string | number;
  closeTime?: number;
};

type RunOnceOpts = { coins?: string[]; sessionId?: string; };
type AutoOpts = { coins?: string[]; intervalMs?: number; immediate?: boolean; };
type AutoState = {
  running: boolean;
  coins: string[];
  intervalMs: number;
  nextAt: number | null;
  lastRanAt: number | null;
};

async function tryImport<T = any>(path: string): Promise<T | null> {
  try { return (await import(/* @vite-ignore */ path)) as T; }
  catch { return null; }
}

/* ---------------- helpers ---------------- */

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

async function fetchTickers24h(symbols: string[]): Promise<Ticker24h[]> {
  const bin = await tryImport<any>("@/sources/binance");
  const out: Ticker24h[] = [];

  const bulk = bin?.fetch24hAll || bin?.fetchTicker24hAll || bin?.fetchTickers24h;
  if (typeof bulk === "function") {
    try {
      const res = await bulk(symbols);
      return Array.isArray(res) ? res : out;
    } catch { /* fallthrough */ }
  }

  const per = bin?.fetchTicker24h || bin?.fetch24h;
  if (typeof per !== "function") return out;

  await Promise.all(symbols.map(async (s) => {
    try { const t = await per(s); if (t && t.symbol) out.push(t as Ticker24h); }
    catch { /* skip */ }
  }));
  return out;
}

/** Minimal fallback math if the real module isn't available. */
function computePrimaryFromTickers(a: string, b: string, tick: Map<string, Ticker24h>) {
  const ta = tick.get(`${a}USDT`) || tick.get(`USDT${a}`);
  const tb = tick.get(`${b}USDT`) || tick.get(`USDT${b}`);
  const pa = Number(ta?.priceChangePercent ?? 0) / 100;
  const pb = Number(tb?.priceChangePercent ?? 0) / 100;
  const id_pct = pa - pb;
  const delta = id_pct;
  const benchmark = Number(ta?.weightedAvgPrice ?? 0) / Math.max(1e-9, Number(tb?.weightedAvgPrice ?? 1));
  const pct24h = Number(ta?.priceChangePercent ?? 0) - Number(tb?.priceChangePercent ?? 0);
  const pct_drv = 0;
  return { id_pct, delta, benchmark, pct24h, pct_drv };
}

async function settingsCoinsFallback(): Promise<string[]> {
  try {
    const s = await getSettingsServer();
    const arr = ((s as any)?.coinUniverse ?? (s as any)?.coins ?? []) as string[];
    if (Array.isArray(arr) && arr.length) return arr.map(x => String(x).toUpperCase());
  } catch {}
  const env = process.env.NEXT_PUBLIC_COINS;
  if (env) return env.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  return ['BTC','ETH','BNB','SOL','ADA','XRP','PEPE','USDT'];
}

async function deriveCoins(): Promise<string[]> {
  try {
    const fake = new URL("http://local.fake/coins");
    const rc = await resolveCoins(fake, { spotOnly: true });
    const out = (rc ?? []).map(x => String(x).toUpperCase());
    if (out.length >= 4) return out;
  } catch {}
  return settingsCoinsFallback();
}

const deriveIntervalMs = async (): Promise<number> => {
  const s = await getSettingsServer().catch(() => null as any);
  const sec = Number((s as any)?.poller?.dur40 ?? (s as any)?.metronome?.dur40 ?? 40);
  const ms = Number((s as any)?.timing?.autoRefreshMs ?? NaN);
  if (Number.isFinite(ms) && ms > 0) return Math.max(500, ms);
  return Math.max(1000, Math.round(sec * 1000));
};

/* ---------------- state ---------------- */

let _timer: NodeJS.Timeout | null = null;
let _busy = false;
let _state: AutoState = {
  running: false,
  coins: [],
  intervalMs: 40_000,
  nextAt: null,
  lastRanAt: null,
};

export function getAutoRefreshState(): AutoState { return { ..._state }; }
export function isAutoRefreshRunning() { return _timer != null; }

/* ---------------- core build ---------------- */

export async function buildAndPersistOnce(opts: RunOnceOpts = {}) {
  const coins = (opts.coins && opts.coins.length) ? opts.coins : await deriveCoins();

  const tickers = await fetchTickers24h(coins);
  const tmap = mapBySymbol(tickers);
  const ts_ms = Date.now();

  const math = await tryImport<any>("@/core/math/matrices");
  let benchmark: number[][] = [];
  let delta: number[][] = [];
  let pct24h: number[][] = [];
  let id_pct: number[][] = [];
  let pct_drv: number[][] = [];

  if (math?.buildPrimaryDirect && math?.buildDerived) {
    const { buildPrimaryDirect, buildDerived } = math;
    const primary = buildPrimaryDirect(coins, Object.fromEntries(tmap));
    benchmark = primary.benchmark;
    pct24h   = primary.pct24h;
    delta    = primary.delta;

    const db = await tryImport<any>("@/core/db");
    const prevGetter = db?.getPrevValue ?? (async () => null);
    const derived = await buildDerived(
      coins,
      ts_ms,
      benchmark,
      (mt: "benchmark"|"id_pct", base: string, quote: string, beforeTs: number) =>
        prevGetter(mt, base, quote, beforeTs)
    );
    id_pct  = derived.id_pct;
    pct_drv = derived.pct_drv;
  } else {
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

  const db = await tryImport<any>("@/core/db");
  const push = (rows: any[]) => db?.upsertMatrixRows ? db.upsertMatrixRows(rows) : Promise.resolve();

  const rowsAll: {
    ts_ms: number;
    matrix_type: 'benchmark'|'delta'|'pct24h'|'id_pct'|'pct_drv';
    base: string; quote: string; value: number; meta?: Record<string, any>;
  }[] = [];

  for (let i = 0; i < coins.length; i++) {
    for (let j = 0; j < coins.length; j++) {
      if (i === j) continue;
      const A = coins[i]!, B = coins[j]!;
      rowsAll.push({ ts_ms, matrix_type: 'benchmark', base: A, quote: B, value: benchmark[i][j] ?? 0 });
      rowsAll.push({ ts_ms, matrix_type: 'delta',     base: A, quote: B, value: delta[i][j] ?? 0 });
      rowsAll.push({ ts_ms, matrix_type: 'pct24h',    base: A, quote: B, value: pct24h[i][j] ?? 0 });
      if (i < j) {
        rowsAll.push({ ts_ms, matrix_type: 'id_pct',  base: A, quote: B, value: id_pct[i][j] ?? 0 });
        rowsAll.push({ ts_ms, matrix_type: 'pct_drv', base: A, quote: B, value: pct_drv[i][j] ?? 0 });
      }
    }
  }

  await push(rowsAll);
  _state.lastRanAt = ts_ms; // <— ensure auto status reflects the last run

  return {
    ok: true,
    ts_ms,
    coins,
    wrote: {
      benchmark: rowsAll.filter(r => r.matrix_type==='benchmark').length,
      delta:     rowsAll.filter(r => r.matrix_type==='delta').length,
      pct24h:    rowsAll.filter(r => r.matrix_type==='pct24h').length,
      id_pct:    rowsAll.filter(r => r.matrix_type==='id_pct').length,
      pct_drv:   rowsAll.filter(r => r.matrix_type==='pct_drv').length,
    },
  };
}

/* ---------------- auto refresh loop ---------------- */

export async function startAutoRefresh(opts: AutoOpts = {}) {
  if (_timer) return true; // already running

  const coins = (opts.coins && opts.coins.length) ? opts.coins : await deriveCoins();
  const intervalMs = opts.intervalMs && opts.intervalMs > 0 ? opts.intervalMs : await deriveIntervalMs();

  const loop = async () => {
    if (_busy) { _timer = setTimeout(loop, 1000); return; }
    _busy = true;
    try {
      _state.running = true;
      _state.coins = coins;
      _state.intervalMs = intervalMs;
      await buildAndPersistOnce({ coins });
      _state.nextAt = Date.now() + intervalMs;
    } catch (e) {
      console.error("[pipeline] auto cycle error", e);
      _state.nextAt = Date.now() + intervalMs;
    } finally {
      _busy = false;
      _timer = setTimeout(loop, intervalMs);
    }
  };

  _state.running = true;
  _state.coins = coins;
  _state.intervalMs = intervalMs;
  _state.nextAt = Date.now() + intervalMs;
  _state.lastRanAt = null;

  if (opts.immediate) {
    await buildAndPersistOnce({ coins });
    _state.nextAt = Date.now() + intervalMs;
  }

  _timer = setTimeout(loop, intervalMs);
  console.info("[pipeline] auto-refresh started", { coins, intervalMs });
  return true;
}

export function stopAutoRefresh() {
  if (_timer) clearTimeout(_timer);
  _timer = null;
  _state.running = false;
  _state.nextAt = null;
}
