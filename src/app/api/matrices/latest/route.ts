import { NextResponse } from "next/server";
import { getSettingsServer } from "@/lib/settings/server";
import {
  fetchTickersForCoins,
  fetchOrderBooksForCoins,
  fetchTicker24h,
} from "@/sources/binance";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FROZEN_DELTA = 1e-9;
const DIRECT_QUOTES = ["BTC", "ETH", "BNB"] as const;

// keep previous cycle to compute "frozen"
const prevPctByKey: Record<string, number[][]> = {};

type TsKey = "benchmark" | "pct24h" | "delta" | "id_pct" | "pct_drv";
type Grid = (number | null)[][];
type FlagGrid = boolean[][];
type Flags = { frozen?: FlagGrid; bridged?: FlagGrid } | null;

const mkGrid = (n: number): Grid => Array.from({ length: n }, () => Array(n).fill(null));
const mkFlag = (n: number): FlagGrid => Array.from({ length: n }, () => Array(n).fill(false));
const num = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : NaN);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const explicit = (url.searchParams.get("coins") || "").split(",").filter(Boolean);
  const now = Date.now();

  const settings = await getSettingsServer();
  const coins =
    (explicit.length ? explicit : settings.coinUniverse)?.filter(Boolean) ||
    ["BTC", "ETH", "BNB", "SOL", "ADA", "USDT"];
  if (!coins.includes("USDT")) coins.push("USDT");

  // USDT baselines
  const [usdtTickers, usdtBooks] = await Promise.all([
    fetchTickersForCoins(coins),
    fetchOrderBooksForCoins(coins, 20),
  ]);

  const n = coins.length;
  const benchmark: Grid = mkGrid(n);
  const id_pct:    Grid = mkGrid(n);
  const pct24h:    Grid = mkGrid(n);
  const delta:     Grid = mkGrid(n);
  const pct_drv:   Grid = mkGrid(n);

  const bridgedB: FlagGrid = mkFlag(n);
  const bridgedP: FlagGrid = mkFlag(n);
  const frozenP:  FlagGrid = mkFlag(n);

  const midUSDT = (c: string) => (c === "USDT" ? 1 : num(usdtBooks[c]?.mid));
  const pctUSDT = (c: string) => (c === "USDT" ? 0 : num(usdtTickers[c]?.pct24h) / 100);

  // 1) Safe baseline via USDT; mark bridged ONLY if neither side is USDT
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        benchmark[i][j] = 0;
        id_pct[i][j] = pct24h[i][j] = delta[i][j] = pct_drv[i][j] = 0;
        continue;
      }
      const a = coins[i], b = coins[j];
      const ma = midUSDT(a), mb = midUSDT(b);
      benchmark[i][j] = Number.isFinite(ma) && Number.isFinite(mb) && mb !== 0 ? ma / mb : null;

      const pa = pctUSDT(a), pb = pctUSDT(b);
      const rel = Number.isFinite(pa) && Number.isFinite(pb) ? (1 + pa) / (1 + pb) - 1 : null;
      id_pct[i][j] = rel;
      pct24h[i][j] = rel;
      const d = typeof rel === "number" ? rel * 0.1 : null;
      delta[i][j] = d;
      pct_drv[i][j] = d;

      const eitherUSDT = a === "USDT" || b === "USDT";
      bridgedB[i][j] = !eitherUSDT;
      bridgedP[i][j] = !eitherUSDT;
    }
  }

  // 2) Opportunistic DIRECT upgrades for quotes in {BTC, ETH, BNB}
  const indexOf: Record<string, number> = Object.fromEntries(coins.map((c, i) => [c, i]));
  const candidates: string[] = [];
  for (const a of coins) {
    for (const q of DIRECT_QUOTES) {
      if (a === q) continue;
      if (indexOf[q] == null) continue;
      candidates.push(`${a}${q}`);
    }
  }
  const settled = await Promise.allSettled(candidates.map((s) => fetchTicker24h(s)));
  settled.forEach((res, idx) => {
    if (res.status !== "fulfilled") return;
    const sym = candidates[idx];
    const quote = sym.slice(-3);
    const base = sym.substring(0, sym.length - 3);
    const i = indexOf[base], j = indexOf[quote];
    if (i == null || j == null) return;

    const last = num(res.value?.lastPrice);
    const pct  = num(res.value?.priceChangePercent);

    if (Number.isFinite(last)) {
      benchmark[i][j] = last;          bridgedB[i][j] = false;
      if (last !== 0) { benchmark[j][i] = 1 / last; bridgedB[j][i] = false; }
    }
    if (Number.isFinite(pct)) {
      const r = pct / 100;
      id_pct[i][j] = pct24h[i][j] = r;  delta[i][j] = pct_drv[i][j] = r * 0.1;  bridgedP[i][j] = false;
      const rInv = 1 / (1 + r) - 1;
      id_pct[j][i] = pct24h[j][i] = rInv; delta[j][i] = pct_drv[j][i] = rInv * 0.1; bridgedP[j][i] = false;
    }
  });

  // 3) FROZEN: compare current pct24h vs previous cycle (always compute)
  const key = `U:${coins.join("|")}`;
  const prev = prevPctByKey[key];
  if (prev) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const cur = pct24h[i][j];
        const old = prev?.[i]?.[j];
        if (typeof cur === "number" && typeof old === "number") {
          if (Math.abs(cur - old) <= FROZEN_DELTA) frozenP[i][j] = true;
        }
      }
    }
  }
  // store for next cycle
  prevPctByKey[key] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (typeof pct24h[i][j] === "number" ? (pct24h[i][j] as number) : NaN))
  );

  const ts: Record<TsKey, number> = { benchmark: now, pct24h: now, delta: now, id_pct: now, pct_drv: now };
  const flags: Record<TsKey, Flags> = {
    // ⬅️ add frozen everywhere so all cards can show purple when frozen
    benchmark: { bridged: bridgedB, frozen: frozenP },
    pct24h:    { bridged: bridgedP, frozen: frozenP },
    delta:     { frozen:  frozenP },
    id_pct:    { bridged: bridgedP, frozen: frozenP },
    pct_drv:   { frozen:  frozenP },
  };

  return NextResponse.json(
    { ok: true, coins, ts, matrices: { benchmark, pct24h, delta, id_pct, pct_drv }, flags, meta: { builtAt: now } },
    { headers: { "Cache-Control": "no-store" } }
  );
}
