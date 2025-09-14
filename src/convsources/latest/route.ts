// src/app/api/matrices/latest/route.ts
import { NextResponse } from "next/server";
import { getSettingsServer } from "@/lib/settings/server";
import { fetchTickersForCoins, fetchTicker24hNum } from "@/sources/binance";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DIRECT_QUOTES = ["USDT", "BTC", "ETH", "BNB"] as const;
const FROZEN_DELTA = Number(process.env.FROZEN_EPS ?? 1e-9);
const CANDIDATE_QUOTES = new Set(["USDT", "BTC", "ETH", "BNB"]);
function directQuotesFrom(coins: string[]): string[] {
  const hits = coins.filter(c => CANDIDATE_QUOTES.has(c));
  return hits.length ? hits : ["USDT"];
}
type TsKey = "benchmark" | "pct24h" | "delta" | "id_pct" | "pct_drv";
type Grid = (number | null)[][];
type FlagGrid = boolean[][];
type Flags = { frozen?: FlagGrid; bridged?: FlagGrid } | null;

const mkGrid = (n: number): Grid => Array.from({ length: n }, () => Array(n).fill(null));
const mkFlag = (n: number): FlagGrid => Array.from({ length: n }, () => Array(n).fill(false));
const num = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : NaN);

const prevPctByKey: Record<string, number[][]> = {};
const prevBenchByKey: Record<string, number[][]> = {};
const prevIdPctByKey: Record<string, number[][]> = {};

async function opt<T = any>(path: string): Promise<T | null> {
  try { return (await import(/* @vite-ignore */ path)) as T; } catch { return null; }
}

function coinsFromQuery(q: string | null): string[] {
  return (q ?? "")
    .split(",")
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
}
function coinsFromEnv(): string[] {
  const raw = process.env.NEXT_PUBLIC_COINS ?? "BTC,ETH,BNB,SOL,ADA,XRP,PEPE,USDT";
  return raw.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
}
function uniqUpper(arr: string[]) {
  const set = new Set<string>();
  arr.forEach(s => set.add(s.toUpperCase()));
  return Array.from(set);
}

/** Resilient orderbook fetcher: coins -> {coin:{mid,bidVol,askVol}}. */
async function getOrderBooksForCoins(
  coins: string[],
  limit: 5 | 10 | 20 | 50 | 100 | 500 | 1000 = 100
): Promise<Record<string, { mid: number; bidVol: number; askVol: number }>> {
  const bin = await import("@/sources/binance");
  const out: Record<string, { mid: number; bidVol: number; askVol: number }> = {};
  if (typeof (bin as any).fetchOrderBooksForCoins === "function") {
    const mp = await (bin as any).fetchOrderBooksForCoins(coins, limit);
    return mp || out;
  }
  if (typeof (bin as any).fetchOrderBooksForSymbols === "function") {
    const symbols = coins.filter((c) => c !== "USDT").map((c) => `${c}USDT`);
    const mp = await (bin as any).fetchOrderBooksForSymbols(symbols, limit);
    for (const c of coins) {
      if (c === "USDT") continue;
      const row = mp?.[`${c}USDT`];
      if (row) out[c] = row;
    }
    return out;
  }
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  // coin universe
  const explicit = (url.searchParams.get("coins") || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const settings = await getSettingsServer().catch(() => null);
  let coins =
    (explicit.length ? explicit : (settings?.coinUniverse ?? []))
      .map((s: string) => s.toUpperCase())
      .filter(Boolean);

  if (!coins.length) coins = ["BTC", "ETH", "BNB", "SOL", "ADA", "XRP", "USDT"];
  if (!coins.includes("USDT")) coins.push("USDT");

  const key = `U:${coins.join("|")}`;
  const n = coins.length;
  const now = Date.now();

  // --- baselines: orderbook mids (USDT) + 24h tickers (percent & last) ---
  let usdtBooks: Record<string, { mid: number; bidVol: number; askVol: number }> = {};
  let usdtTickers: any = {};

  try {
    const [books, ticks] = await Promise.all([
      getOrderBooksForCoins(coins, 20),
      fetchTickersForCoins(coins),
    ]);
    usdtBooks = books || {};
    usdtTickers = ticks || {};
  } catch {}

  const lastUSDT: Record<string, number | null> = {};
  const pctUSDT_percent: Record<string, number | null> = {};
  const dltUSDT_abs: Record<string, number | null> = {};

  for (const c of coins) {
    const mid = c === "USDT" ? 1 : num(usdtBooks?.[c]?.mid);
    const t = usdtTickers?.[c];
    const tLast = t?.price ?? NaN;
    const pctp = t?.pct24h ?? NaN;

    const last = Number.isFinite(mid) ? mid : Number.isFinite(tLast) ? tLast : null;
    lastUSDT[c] = c === "USDT" ? 1 : last;

    pctUSDT_percent[c] = c === "USDT" ? 0 : Number.isFinite(pctp) ? pctp : null;

    if (c === "USDT") {
      dltUSDT_abs[c] = 0;
    } else if (lastUSDT[c] != null && Number.isFinite(pctp)) {
      const r = (pctp as number) / 100;
      const open = lastUSDT[c]! / (1 + r);
      dltUSDT_abs[c] = lastUSDT[c]! - open;
    } else {
      dltUSDT_abs[c] = null;
    }
  }

  // --- direct A/Q candidates to upgrade triangulated values ---
  const idxOf: Record<string, number> = Object.fromEntries(coins.map((c, i) => [c, i]));
  const directSyms: string[] = [];
  for (const a of coins) {
    for (const q of DIRECT_QUOTES) {
      if (a === q) continue;
      if (idxOf[q] == null) continue;
      directSyms.push(`${a}${q}`);
    }
  }

  const directMap = new Map<string, Awaited<ReturnType<typeof fetchTicker24hNum>>>();
  const settled = await Promise.allSettled(directSyms.map((s) => fetchTicker24hNum(s)));
  settled.forEach((res, i) => {
    if (res.status === "fulfilled" && res.value?.symbol) directMap.set(directSyms[i]!, res.value);
  });

  // --- allocate matrices & flags ---
  const benchmark: Grid = mkGrid(n);
  const pct24h: Grid = mkGrid(n);
  const delta: Grid = mkGrid(n);
  const id_pct: Grid = mkGrid(n);
  const pct_drv: Grid = mkGrid(n);

  const bridgedB: FlagGrid = mkFlag(n);
  const bridgedP: FlagGrid = mkFlag(n);
  const frozenP: FlagGrid = mkFlag(n);

  // --- pass 1: USDT triangulation (baseline estimates) ---
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const A = coins[i], B = coins[j];
    const pA = lastUSDT[A], pB = lastUSDT[B];
    const qA = pctUSDT_percent[A], qB = pctUSDT_percent[B];
    const dA = dltUSDT_abs[A], dB = dltUSDT_abs[B];

    if (pA != null && pB != null && pB !== 0) benchmark[i][j] = pA / pB;

    if (qA != null && qB != null) {
      const relPct = ((1 + qA / 100) / (1 + qB / 100) - 1) * 100;
      pct24h[i][j] = relPct;
    }

    if (pA != null && pB != null && pB !== 0 && dA != null && dB != null) {
      const term1 = dA / pB;
      const term2 = (pA / pB) * (dB / pB);
      delta[i][j] = term1 - term2;
    }

    const eitherUSDT = A === "USDT" || B === "USDT";
    bridgedB[i][j] = !eitherUSDT;
    bridgedP[i][j] = !eitherUSDT;
  }

  // --- pass 2: upgrade with direct Binance A/B tickers where available ---
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const A = coins[i], B = coins[j], sym = `${A}${B}`;
    const t = directMap.get(sym);
    if (!t) continue;

    const { last, pct24h: p, delta: d, open } = t;

    if (Number.isFinite(last!)) {
      benchmark[i][j] = last!;
      if (last! !== 0) benchmark[j][i] = 1 / last!;
      bridgedB[i][j] = bridgedB[j][i] = false;
    }

    if (Number.isFinite(p!)) {
      pct24h[i][j] = p!;
      const r = p! / 100;
      const invPct = (1 / (1 + r) - 1) * 100;
      pct24h[j][i] = invPct;
      bridgedP[i][j] = bridgedP[j][i] = false;
    }

    if (Number.isFinite(d!)) {
      delta[i][j] = d!;
      if (Number.isFinite(last!) && Number.isFinite(open!) && open! !== 0) {
        const invNow = 1 / last!;
        const invOld = 1 / open!;
        delta[j][i] = invNow - invOld;
      }
    }
  }

  // --- derived matrices (id_pct & pct_drv) ---
  try {
    const math = await opt<any>("@/core/math/matrices");
    const db = await opt<any>("@/core/db");
    if (math?.buildDerived && db?.getPrevValue) {
      const getPrev = async (mt: "benchmark" | "id_pct", base: string, quote: string, beforeTs: number) =>
        await db.getPrevValue(mt, base, quote, beforeTs);
      const derived = await math.buildDerived(coins, now, benchmark, getPrev);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        id_pct[i][j] = derived.id_pct[i][j];
        pct_drv[i][j] = derived.pct_drv[i][j];
      }
    } else {
      const prevB = prevBenchByKey[key];
      const prevI = prevIdPctByKey[key];

      if (prevB) {
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const cur = benchmark[i][j], prv = prevB?.[i]?.[j];
          id_pct[i][j] =
            typeof cur === "number" && typeof prv === "number" && prv !== 0
              ? (cur - prv) / prv
              : null;
        }
      }

      if (prevI) {
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const cur = id_pct[i][j], prv = prevI?.[i]?.[j];
          pct_drv[i][j] = typeof cur === "number" && typeof prv === "number" ? cur - prv : null;
        }
      }
    }
  } catch {}

  // --- "frozen" flags from pct24h stability ---
  try {
    const prev = prevPctByKey[key];
    if (prev) {
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const cur = pct24h[i][j], old = prev?.[i]?.[j];
        if (typeof cur === "number" && typeof old === "number" && Math.abs(cur - old) <= FROZEN_DELTA) {
          frozenP[i][j] = true;
        }
      }
    }
  } catch {}

  // snapshots for next cycle
  prevPctByKey[key]   = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (typeof pct24h[i][j] === "number" ? (pct24h[i][j] as number) : NaN)));
  prevBenchByKey[key] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (typeof benchmark[i][j] === "number" ? (benchmark[i][j] as number) : NaN)));
  prevIdPctByKey[key] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (typeof id_pct[i][j] === "number" ? (id_pct[i][j] as number) : NaN)));

  const ts: Record<TsKey, number> = { benchmark: now, pct24h: now, delta: now, id_pct: now, pct_drv: now };

  const flags: Record<TsKey, Flags> = {
    benchmark: { bridged: bridgedB, frozen: frozenP },
    pct24h:    { bridged: bridgedP, frozen: frozenP },
    delta:     { frozen:  frozenP },
    id_pct:    { bridged: bridgedP, frozen: frozenP },
    pct_drv:   { frozen:  frozenP },
  };

  const anyData =
    benchmark.some((r) => r.some((v) => typeof v === "number")) ||
    pct24h.some((r) => r.some((v) => typeof v === "number")) ||
    delta.some((r) => r.some((v) => typeof v === "number"));

  if (!anyData) {
    return NextResponse.json(
      { ok: false, error: "no_data", coins, matrices: { benchmark, pct24h, delta, id_pct, pct_drv }, flags, ts },
      { headers: { "Cache-Control": "no-store" }, status: 200 }
    );
  }

  return NextResponse.json(
    { ok: true, coins, ts, matrices: { benchmark, pct24h, delta, id_pct, pct_drv }, flags, meta: { builtAt: now } },
    { headers: { "Cache-Control": "no-store" } }
  );
}
