// Server-only singleton to sample Binance public data and persist via buildStrAux + db.
// No API keys used. Uses klines for "points" + 24h ticker for pct24h/opening.

import { setTimeout as delay } from "timers/promises";
import { buildStrAux } from "../../str-aux/buildStrAux";
import { db } from "@/lib/str-aux/db";

type WindowKey = "30m" | "1h" | "3h";

type SamplerConfig = {
  symbol: string;            // e.g., "BTCUSDT"
  base: string;              // e.g., "BTC"
  quote: string;             // e.g., "USDT"
  window: WindowKey;         // app window
  appSessionId: string;      // e.g., "dev-session"
  intervalSec: number;       // sampling cadence, default 15s
  klineInterval: string;     // binance interval for klines, e.g., "1m"
  klineLimit: number;        // how many candles to fetch
};

type SamplerState = {
  running: boolean;
  lastOk?: number;       // ms
  lastError?: string;
  ticks: number;
  cfg?: SamplerConfig;
};

const state: SamplerState = {
  running: false,
  ticks: 0,
};

async function fetch24h(symbol: string) {
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`binance 24hr ${symbol} HTTP ${res.status}`);
  return res.json() as Promise<{
    priceChangePercent: string;
    lastPrice: string;
    highPrice: string;
    lowPrice: string;
    volume: string;
    quoteVolume: string;
    openTime: number;
    closeTime: number;
  }>;
}

type Kline = [
  number,  // open time ms
  string,  // open
  string,  // high
  string,  // low
  string,  // close
  string,  // volume base
  number,  // close time ms
  string,  // quote asset volume
  number,  // number of trades
  string,  // taker buy base asset volume
  string,  // taker buy quote asset volume
  string   // ignore
];

async function fetchKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`binance klines ${symbol} ${interval} HTTP ${res.status}`);
  return res.json();
}

async function sampleOnce(cfg: SamplerConfig) {
  const [t24, kl] = await Promise.all([
    fetch24h(cfg.symbol),
    fetchKlines(cfg.symbol, cfg.klineInterval, cfg.klineLimit),
  ]);

  const ts = Date.now();
  const pct24h = Number(t24.priceChangePercent) / 100;

  // Convert klines to points (use close price & volume at close time)
  const points = kl.map((c) => {
    const closeTime = Number(c[6]);
    const close = Number(c[4]);
    const volBase = Number(c[5] || 0);
    return { ts: closeTime, price: close, volume: volBase };
  });

  const opening = {
    benchmark: 1,
    pct24h,
    pct_drv: pct24h,     // provisional; refine later
    ts,
    layoutHash: "binance-24h",
  };

  const doc = await buildStrAux({
    pair: { base: cfg.base, quote: cfg.quote, window: cfg.window, appSessionId: cfg.appSessionId },
    opening,
    points,
    metrics: {
      benchmarkPrev: 1,
      benchmarkCur: 1,
      pct24hPrev: 0,
      pct24hCur: pct24h,
      idPctPrev: 0,
      idPctCur: pct24h,
    },
    latestTs: ts,
    refGfm: null,
  });

  await db.upsert({
    ...doc,
    pair: { ...doc.pair, appSessionId: doc.pair.appSessionId ?? cfg.appSessionId },
    appSessionId: doc.pair.appSessionId ?? cfg.appSessionId,
  });
}

async function loop(cfg: SamplerConfig) {
  state.cfg = cfg;
  state.running = true;
  state.lastError = undefined;

  const minInterval = Math.max(5, cfg.intervalSec) * 1000;
  let backoffMs = minInterval;

  while (state.running) {
    try {
      await sampleOnce(cfg);
      state.ticks += 1;
      state.lastOk = Date.now();
      state.lastError = undefined;
      backoffMs = minInterval; // reset backoff on success
    } catch (e: any) {
      state.lastError = e?.message ?? String(e);
      // exponential-ish backoff capped at 60s
      backoffMs = Math.min(Math.round(backoffMs * 1.5), 60_000);
    }
    await delay(backoffMs);
  }
}

export function startTicker(opts: Partial<SamplerConfig> & { symbol?: string } = {}) {
  if (state.running) return { ok: false, error: "already_running", status: getStatus() };

  const symbol = (opts.symbol ?? "BTCUSDT").toUpperCase();
  const base = symbol.replace(/USDT$/, "");
  const quote = "USDT";

  const cfg: SamplerConfig = {
    symbol,
    base,
    quote,
    window: (opts.window ?? "30m") as WindowKey,
    appSessionId: opts.appSessionId ?? "dev-session",
    intervalSec: opts.intervalSec ?? 15,
    klineInterval: opts.klineInterval ?? "1m",
    klineLimit: opts.klineLimit ?? 60,
  };

  // fire & forget
  void loop(cfg);
  return { ok: true, status: getStatus() };
}

export function stopTicker() {
  if (!state.running) return { ok: false, error: "not_running", status: getStatus() };
  state.running = false;
  return { ok: true, status: getStatus() };
}

export function getStatus() {
  return {
    running: state.running,
    ticks: state.ticks,
    lastOk: state.lastOk ?? null,
    lastError: state.lastError ?? null,
    cfg: state.cfg ?? null,
  };
}
