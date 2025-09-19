// src/core/pipeline.ts
import { getSettingsServer } from "@/lib/settings/server";
import { resolveCoins } from "@/lib/coins/resolve";
import {
  getPollerSnapshot,
  subscribeToPoller,
  type PollerTickEvent,
} from "@/lib/poller/server";

/* --------------------------------- types ---------------------------------- */

type Ticker24h = {
  symbol: string;
  lastPrice?: string | number;
  priceChangePercent?: string | number;
  weightedAvgPrice?: string | number;
  openPrice?: string | number;
  closeTime?: number;
};

type RunOnceOpts = { coins?: string[]; sessionId?: string };
type AutoOpts = { coins?: string[]; intervalMs?: number; immediate?: boolean };

type AutoState = {
  running: boolean;
  coins: string[];
  intervalMs: number;
  nextAt: number | null;
  lastRanAt: number | null;
};

type NumberGrid = number[][];

interface MatricesModule {
  buildPrimaryDirect?: (
    coins: string[],
    tickersBySymbol: Record<string, Ticker24h>
  ) => {
    benchmark: NumberGrid | (number | null)[][];
    pct24h: NumberGrid | (number | null)[][];
    delta: NumberGrid | (number | null)[][];
  };
  buildDerived?: (
    coins: string[],
    ts_ms: number,
    benchmark: NumberGrid,
    getPrev: (
      mt: "benchmark" | "id_pct",
      base: string,
      quote: string,
      beforeTs: number
    ) => Promise<number | null> | number | null
  ) => Promise<{
    id_pct: NumberGrid | (number | null)[][];
    pct_drv: NumberGrid | (number | null)[][];
  }> | {
    id_pct: NumberGrid | (number | null)[][];
    pct_drv: NumberGrid | (number | null)[][];
  };
}

/* ------------------------------- helpers ---------------------------------- */

const parseList = (s?: string | null) =>
  (s ?? "").split(",").map(x => x.trim().toUpperCase()).filter(Boolean);

const ANCHORS = new Set<string>(parseList(process.env.MATRIX_ANCHORS ?? "USDT,BRL"));
const INCLUDE_ANCHOR_BASES = /^(1|true|on|yes)$/i.test(
  String(process.env.MATRIX_INCLUDE_ANCHOR_BASES ?? "")
);

function baseCoinsOf(coins: string[]): string[] {
  return INCLUDE_ANCHOR_BASES ? coins : coins.filter(c => !ANCHORS.has(c));
}

function coerceNumberGrid(g: (number | null)[][], def = 0): NumberGrid {
  return g.map(row => row.map(v => (Number.isFinite(Number(v)) ? Number(v) : def)));
}
function ensureNumberGrid(g: unknown, n: number, def = 0): NumberGrid {
  if (Array.isArray(g)) {
    const arr = g as (number | null)[][];
    return coerceNumberGrid(
      arr.map(row => (Array.isArray(row) ? row.slice(0, n) : Array(n).fill(def))),
      def
    );
  }
  return Array.from({ length: n }, () => Array(n).fill(def));
}

async function loadMathMatrices(): Promise<MatricesModule | null> {
  try {
    const mod = (await import("@/core/math/matrices")) as unknown as MatricesModule;
    return mod ?? null;
  } catch { return null; }
}
async function loadDb(): Promise<any | null> {
  try { return await import("@/core/db"); } catch { return null; }
}
async function loadBinance(): Promise<any | null> {
  try { return await import("@/sources/binance"); } catch { return null; }
}

function mapBySymbol(list: Ticker24h[]): Map<string, Ticker24h> {
  const m = new Map<string, Ticker24h>();
  for (const t of list) if (t?.symbol) m.set(String(t.symbol).toUpperCase(), t);
  return m;
}
function allPairsWithin(coins: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < coins.length; i++) {
    for (let j = 0; j < coins.length; j++) {
      if (i === j) continue;
      pairs.push([coins[i]!, coins[j]!] as [string, string]);
    }
  }
  return pairs;
}

async function fetchTickers24h(symbols: string[]): Promise<Ticker24h[]> {
  const bin = await loadBinance();
  const out: Ticker24h[] = [];

  const bulk = bin?.fetch24hAll ?? bin?.fetchTicker24hAll ?? bin?.fetchTickers24h;
  if (typeof bulk === "function") {
    try {
      const res = await bulk(symbols);
      return Array.isArray(res) ? res : out;
    } catch { /* fall through */ }
  }

  const per = bin?.fetchTicker24h ?? bin?.fetch24h;
  if (typeof per !== "function") return out;

  await Promise.all(symbols.map(async s => {
    try {
      const t = await per(s);
      if (t && (t as any).symbol) out.push(t as Ticker24h);
    } catch {}
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
  const benchmark =
    Number(ta?.weightedAvgPrice ?? 0) / Math.max(1e-9, Number(tb?.weightedAvgPrice ?? 1));
  const pct24h =
    Number(ta?.priceChangePercent ?? 0) - Number(tb?.priceChangePercent ?? 0);
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
  return ["BTC","ETH","BNB","SOL","ADA","DOGE","USDT","PEPE","BRL"];
}

async function resolveCoinsFromList(list: string[]) {
  const url = new URL("http://_internal_/coins");
  url.searchParams.set("coins", list.join(","));
  const rc = await resolveCoins(url, { spotOnly: true });
  return Array.isArray(rc) ? rc.map(x => String(x).toUpperCase()) : [];
}

async function deriveCoins(): Promise<string[]> {
  const base = await settingsCoinsFallback();
  if (!base.length) return base;
  try {
    const filtered = await resolveCoinsFromList(base);
    if (filtered.length >= base.length) return filtered;
    if (filtered.length >= 4) {
      const missing = base.filter(c => !filtered.includes(c));
      return filtered.concat(missing);
    }
  } catch {}
  return base;
}

/* -------------------------------- state ----------------------------------- */

let _busy = false;
let _state: AutoState = {
  running: false,
  coins: [],
  intervalMs: 40_000,
  nextAt: null,
  lastRanAt: null,
};
let _unsub: (() => void) | null = null;

export function getAutoRefreshState(): AutoState { return { ..._state }; }
export function isAutoRefreshRunning() { return _unsub != null; }

/* ------------------------------- core build -------------------------------- */

export async function buildAndPersistOnce(opts: RunOnceOpts = {}) {
  const coins = opts.coins && opts.coins.length ? opts.coins : await deriveCoins();
  const C = coins.map(c => String(c).toUpperCase());
  const bases = baseCoinsOf(C);
  const ts_ms = Date.now();

  const tickers = await fetchTickers24h(Array.from(new Set(C.flatMap(x => [`${x}USDT`,`USDT${x}`]))));
  const tmap = mapBySymbol(tickers);

  let benchmark: NumberGrid = [];
  let delta: NumberGrid = [];
  let pct24h: NumberGrid = [];
  let id_pct: NumberGrid = [];
  let pct_drv: NumberGrid = [];

  const math = await loadMathMatrices();

  if (math?.buildPrimaryDirect) {
    const prim = math.buildPrimaryDirect(C, Object.fromEntries(tmap))!;
    benchmark = ensureNumberGrid(prim?.benchmark, C.length, 0);
    pct24h  = ensureNumberGrid(prim?.pct24h,   C.length, 0);
    delta   = ensureNumberGrid(prim?.delta,    C.length, 0);

    if (math.buildDerived) {
      const db = await loadDb();
      const getPrev =
        (db as any)?.getPrevValue ?? (async () => null as number | null);
      const derived = await math.buildDerived(
        C,
        ts_ms,
        benchmark,
        async (mt, base, quote, beforeTs) => {
          const v = await getPrev(mt, base, quote, beforeTs);
          return typeof v === "number" && Number.isFinite(v) ? v : null;
        }
      );
      id_pct = ensureNumberGrid(derived?.id_pct, C.length, 0);
      pct_drv = ensureNumberGrid(derived?.pct_drv, C.length, 0);
    } else {
      const n = C.length;
      id_pct = Array.from({ length: n }, () => Array(n).fill(0));
      pct_drv = Array.from({ length: n }, () => Array(n).fill(0));
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const bm = benchmark[i][j], dl = delta[i][j];
        id_pct[i][j] = bm !== 0 ? dl / bm : 0;
        pct_drv[i][j] = 0;
      }
    }
  } else {
    const n = C.length;
    benchmark = Array.from({ length: n }, () => Array(n).fill(0));
    pct24h    = Array.from({ length: n }, () => Array(n).fill(0));
    delta     = Array.from({ length: n }, () => Array(n).fill(0));
    id_pct    = Array.from({ length: n }, () => Array(n).fill(0));
    pct_drv   = Array.from({ length: n }, () => Array(n).fill(0));
    for (const [a,b] of allPairsWithin(C)) {
      const i = C.indexOf(a), j = C.indexOf(b);
      if (i < 0 || j < 0) continue;
      const v = computePrimaryFromTickers(a,b,tmap);
      benchmark[i][j] = v.benchmark;
      pct24h[i][j]    = v.pct24h;
      delta[i][j]     = v.delta;
      id_pct[i][j]    = v.id_pct;
      pct_drv[i][j]   = v.pct_drv;
    }
  }

  const db = await loadDb();
  const upsert = (db as any)?.upsertMatrixRows as undefined | ((rows: any[]) => Promise<void>);
  if (upsert) {
    const rowsAll: {
      ts_ms: number;
      matrix_type: "benchmark" | "delta" | "pct24h" | "id_pct" | "pct_drv";
      base: string;
      quote: string;
      value: number;
      meta?: Record<string, any>;
    }[] = [];

    for (let i = 0; i < bases.length; i++) for (let j = 0; j < bases.length; j++) {
      if (i === j) continue;
      const A = bases[i]!, B = bases[j]!;
      const ai = C.indexOf(A), bj = C.indexOf(B);
      if (ai < 0 || bj < 0) continue;
      rowsAll.push({ ts_ms, matrix_type: "benchmark", base: A, quote: B, value: benchmark[ai]?.[bj] ?? 0 });
      rowsAll.push({ ts_ms, matrix_type: "delta",     base: A, quote: B, value: delta[ai]?.[bj] ?? 0 });
      rowsAll.push({ ts_ms, matrix_type: "pct24h",    base: A, quote: B, value: pct24h[ai]?.[bj] ?? 0 });
      rowsAll.push({ ts_ms, matrix_type: "id_pct",    base: A, quote: B, value: id_pct[ai]?.[bj] ?? 0 });
      rowsAll.push({ ts_ms, matrix_type: "pct_drv",   base: A, quote: B, value: pct_drv[ai]?.[bj] ?? 0 });
    }

    await upsert(rowsAll);
  }

  _state.lastRanAt = ts_ms;

  return {
    ok: true,
    ts_ms,
    coins: C,
    wrote: (() => {
      const m = baseCoinsOf(C).length;
      const r = m * (m - 1);
      return { benchmark: r, delta: r, pct24h: r, id_pct: r, pct_drv: r };
    })(),
  };
}

/* --------------------------- auto refresh via server poller ---------------- */

export async function startAutoRefresh(opts: AutoOpts = {}) {
  if (_unsub) return true; // already wired

  const coins = opts.coins && opts.coins.length ? opts.coins : await deriveCoins();
  const snap = await getPollerSnapshot(); // server poller timing (baseMs, cycles, etc.) :contentReference[oaicite:0]{index=0}

  _state.running = true;
  _state.coins = coins.map(c => c.toUpperCase());
  _state.intervalMs = snap.baseMs;
  _state.nextAt = Date.now() + snap.baseMs;
  _state.lastRanAt = null;

  if (opts.immediate) {
    await buildAndPersistOnce({ coins: _state.coins });
    _state.nextAt = Date.now() + snap.baseMs;
  }

  const unsub = await subscribeToPoller((ev: PollerTickEvent) => {
    _state.intervalMs = ev.config.baseMs;
    if (_busy || !_state.running) {
      _state.nextAt = Date.now() + ev.config.baseMs;
      return;
    }
    _busy = true;
    buildAndPersistOnce({ coins: _state.coins })
      .catch(err => { if (process.env.NODE_ENV !== "production") console.error("[pipeline] cycle error", err); })
      .finally(() => {
        _busy = false;
        _state.nextAt = Date.now() + ev.config.baseMs;
      });
  });
  _unsub = unsub;
  return true;
}

export function stopAutoRefresh() {
  if (_unsub) _unsub();
  _unsub = null;
  _state.running = false;
  _state.nextAt = null;
}

export { _state as __autoStateDebug };
