// src/sources/binanceTicker.ts
/* eslint-disable no-console */
import type { Point, WindowKey } from "@/lab/str-aux/types";
import { requiredPointCount } from "@/lab/str-aux/circular";
import { fetch24hAll, mapTickerBySymbol } from "@/sources/binance";

type StartArgs = { base: string; quote: string; window: WindowKey; appSessionId?: string };

type State = {
  symbol: string; window: WindowKey; appSessionId: string;
  ws?: any;
  lastMid?: number;
  volAcc: number;            // base-asset volume acc for the current second
  samples: Point[];          // 1s samples
  points: Point[];           // circular points
  posting: boolean;
  alive: boolean;
  t24?: { pct: number; last: number }; // cache of 24h % and last price
};

const API = process.env.STR_AUX_API ?? "http://localhost:3000/api/str-aux";
const WSHOST = process.env.BINANCE_WS_HOST ?? "wss://stream.binance.com:9443";

declare global { var __strAuxRegistry: Map<string, State> | undefined; }
const reg: Map<string, State> = (globalThis.__strAuxRegistry ??= new Map());

// --- public helpers ---
export function listTickers() { return Array.from(reg.keys()); }

export async function startTicker({ base, quote, window, appSessionId }: StartArgs) {
  const symbol = `${base}${quote}`.toUpperCase();
  const key = `${symbol}:${window}`;
  if (reg.get(key)?.alive) return { alreadyRunning: true, key };

  // lazy import ws (node-only)
  const { default: WS } = await import("ws");
  const streams = `${symbol.toLowerCase()}@bookTicker/${symbol.toLowerCase()}@aggTrade`;
  const url = `${WSHOST}/stream?streams=${streams}`;

  const s: State = {
    symbol, window, appSessionId: appSessionId ?? "binance-session",
    volAcc: 0, samples: [], points: [], posting: false, alive: true,
  };
  reg.set(key, s);

  // kick a 24h refresher (1/min)
  void refresh24hLoop(s);

  const ws = new WS(url);
  s.ws = ws as any;

  ws.on("open", () => console.log(`[str-aux] ws open ${streams}`));
  ws.on("close", () => (s.alive = false));
  ws.on("error", (e: unknown) => console.error("[str-aux] ws error", e));

  ws.on("message", (buf: Buffer) => {
    try {
      const m = JSON.parse(buf.toString());
      if (m?.stream?.endsWith("@bookTicker")) {
        const d = m.data; const b = Number(d?.b); const a = Number(d?.a);
        if (Number.isFinite(b) && Number.isFinite(a)) s.lastMid = (a + b) / 2;
      } else if (m?.stream?.endsWith("@aggTrade")) {
        const d = m.data; const q = Number(d?.q);
        if (Number.isFinite(q)) s.volAcc += q;
      }
    } catch {}
  });

  // 1s sampler
  const secTimer = setInterval(() => onSecond(s), 1000);
  ws.on("close", () => clearInterval(secTimer));

  return { started: true, key };
}

export function stopTicker({ base, quote, window }: { base: string; quote: string; window: WindowKey }) {
  const key = `${(base + quote).toUpperCase()}:${window}`;
  const s = reg.get(key);
  if (!s) return { ok: false, reason: "not_running" };
  s.alive = false;
  try { s.ws && s.ws.close(); } catch {}
  reg.delete(key);
  return { ok: true };
}

// --- internals ---
async function refresh24hLoop(s: State) {
  while (s.alive) {
    try {
      const rows = await fetch24hAll();
      const map = mapTickerBySymbol(rows);
      const r = map.get(s.symbol);
      if (r) {
        const pct = Number(r.priceChangePercent) / 100;
        const last = Number(r.lastPrice);
        if (Number.isFinite(pct) && Number.isFinite(last)) s.t24 = { pct, last };
      }
    } catch (e) {
      console.warn("[str-aux] 24h refresh failed", (e as any)?.message ?? e);
    }
    await sleep(60_000);
  }
}

function onSecond(s: State) {
  if (!s.alive) return;
  const now = Date.now();
  const p = s.lastMid;
  const vol = s.volAcc; s.volAcc = 0;
  if (!Number.isFinite(p)) return;
  const price = p as number;

  s.samples.push({ price, volume: vol, ts: now });

  if (s.samples.length >= 40) {
    // Build point (VWAP across 40s)
    const batch = s.samples.slice(-40);
    const volSum = batch.reduce((a, p) => a + (p.volume || 0), 0);
    const vwap = volSum > 0
      ? batch.reduce((a, p) => a + p.price * (p.volume || 0), 0) / volSum
      : batch.reduce((a, p) => a + p.price, 0) / batch.length;

    s.points.push({ price: vwap, volume: volSum, ts: now });

    // Circular per window
    const need = requiredPointCount(s.window);
    if (s.points.length > need) s.points = s.points.slice(-need);

    void postCompute(s);
    s.samples = [];
  }
}

async function postCompute(s: State) {
  if (s.posting) return;
  s.posting = true;
  try {
    const cur = s.points.length ? s.points[s.points.length - 1].price : s.lastMid ?? 0;
    const prev = s.points.length > 1 ? s.points[s.points.length - 2].price : cur;
    const pct_drvPrev = 0;
    const pct_drvCur = prev === 0 ? 0 : (cur - prev) / prev;

    const payload = {
      pair: { base: symbolBase(s.symbol), quote: symbolQuote(s.symbol), window: s.window, appSessionId: s.appSessionId },
      // no opening → buildStrAux will create a deterministic layoutHash
      points: s.points,
      metrics: {
        benchmarkPrev: prev, benchmarkCur: cur,
        pct24hPrev: s.t24?.pct ?? 0, pct24hCur: s.t24?.pct ?? 0, // keep flat; we can track prev later
        pct_drvPrev, pct_drvCur,
      },
    };

    const res = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const j = await res.json();
    if (!res.ok) console.error("[str-aux] compute failed", j);
  } catch (e) {
    console.error("[str-aux] post error", (e as any)?.message ?? e);
  } finally {
    s.posting = false;
  }
}

function symbolBase(sym: string) { return sym.replace(/USDT$/, ""); }
function symbolQuote(sym: string) { return sym.endsWith("USDT") ? "USDT" : sym.slice(-4); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
