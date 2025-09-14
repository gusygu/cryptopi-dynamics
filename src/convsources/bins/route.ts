import { NextResponse } from "next/server";

import type { WindowKey, MarketPoint, OpeningExact } from "@/str-aux/types";
import { computeIdhrBinsN, computeFM } from "@/str-aux/idhr";
import { getOrInitSymbolSession, updateSymbolSession, exportStreams } from "@/str-aux/session";
import { upsertSession } from "@/lib/str-aux/sessionDb";

import {
  fetchKlines,
  fetchOrderBook,
  fetchTicker24h,
  fetch24hAll,
  type RawKline,
} from "@/sources/binance";

import { getAll as getSettings } from "@/lib/settings/server";
import {
  pairsFromSettings,
  usdtLegsFromCoins,
  normalizeCoin,
  type PairAvailability,
} from "@/lib/markets/pairs";

/* -------------------------------------------------------------------------- */

type Interval = "1m" | "5m" | "15m" | "30m" | "1h";

function windowToInterval(w: WindowKey): { interval: Interval; klineLimit: number } {
  switch (w) {
    case "30m": return { interval: "1m",  klineLimit: 240 };
    case "1h":  return { interval: "1m",  klineLimit: 360 };
    case "3h":  return { interval: "5m",  klineLimit: 240 };
    default:    return { interval: "1m",  klineLimit: 240 };
  }
}

const norm = normalizeCoin;

/** Parse list tokens (coins or symbols) from query. Accepts `coins=` or `pairs=` */
function parseListParam(url: URL, keys = ["coins", "pairs"]): string[] {
  for (const k of keys) {
    const raw = String(url.searchParams.get(k) ?? "").trim();
    if (!raw) continue;
    return raw.toUpperCase().split(/[,\s]+/).map(v => v.trim()).filter(Boolean);
  }
  return [];
}
function parseWindow(s: string | null | undefined): WindowKey {
  const v = (s ?? "30m").toLowerCase();
  return (v === "30m" || v === "1h" || v === "3h") ? (v as WindowKey) : "30m";
}
function parseBinsParam(s: string | null | undefined, dflt = 128) {
  const n = Number(s ?? dflt);
  return Number.isFinite(n) && n > 0 ? Math.min(2048, Math.max(8, Math.floor(n))) : dflt;
}

function klinesToPoints(kl: RawKline[]): MarketPoint[] {
  return (kl ?? []).map((k) => {
    const openTime = Number(k[0]);   // ms
    const close    = Number(k[4]);   // close price
    const vol      = Number(k[5]);   // base volume
    return { ts: openTime, price: close, volume: Number.isFinite(vol) ? vol : 0 };
  });
}
async function orderbookPoint(symbol: string): Promise<MarketPoint | null> {
  try {
    const ob = await fetchOrderBook(symbol, 100);
    if (Number.isFinite(ob.mid) && ob.mid > 0) {
      const vol = (Number(ob.bidVol) || 0) + (Number(ob.askVol) || 0);
      return { ts: ob.ts, price: ob.mid, volume: vol };
    }
  } catch {}
  return null;
}
async function loadPoints(symbol: string, windowKey: WindowKey, binsN: number): Promise<MarketPoint[]> {
  const { interval, klineLimit } = windowToInterval(windowKey);
  const pts: MarketPoint[] = [];

  try {
    const kl = await fetchKlines(symbol, interval, Math.max(klineLimit, binsN * 2));
    pts.push(...klinesToPoints(kl));
  } catch {}

  const obPt = await orderbookPoint(symbol);
  if (obPt) pts.push(obPt);

  // sort + dedup
  const seen = new Set<number>();
  const uniq: MarketPoint[] = [];
  for (const p of pts.sort((a, b) => a.ts - b.ts)) {
    if (!seen.has(p.ts)) { seen.add(p.ts); uniq.push(p); }
  }
  return uniq;
}

/* ------------------- preview verification (batch, robust) ------------------- */

async function verifySymbolsMulti(symbols: string[], chunkSize = 200): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < symbols.length; i += chunkSize) {
    const chunk = symbols.slice(i, i + chunkSize);
    try {
      const arr = await fetch24hAll(chunk); // Binance returns only existing markets
      for (const t of arr ?? []) if (t?.symbol) out.add(String(t.symbol).toUpperCase());
    } catch {
      // ignore this chunk; USDT fallback still works
    }
  }
  return out;
}

/* --------------------------------- opening --------------------------------- */

function ensureOpening(points: MarketPoint[], fallbackPrice: number, tsNow: number): OpeningExact {
  const p0 = Number(points[0]?.price ?? fallbackPrice ?? 0);
  return {
    benchmark: p0 > 0 ? p0 : 0,
    pct24h: 0,
    id_pct: 0,
    ts: Number(points[0]?.ts ?? tsNow),
    layoutHash: "str-aux:idhr-128",
  };
}

/* --------------------------- symbol split (NEW) ----------------------------- */

const KNOWN_QUOTES = ["USDT","BTC","ETH","BNB","FDUSD","BUSD","TUSD","USDC","TRY"];
function splitSymbol(s: string): { base: string; quote: string } {
  const U = String(s || "").toUpperCase();
  for (const q of KNOWN_QUOTES) {
    if (U.endsWith(q) && U.length > q.length) return { base: U.slice(0, U.length - q.length), quote: q };
  }
  // fallback: 3/4-letter base heuristic
  const base = U.slice(0, 3);
  const quote = U.slice(3) || "USDT";
  return { base, quote };
}

/* ---------------------------------- GET ------------------------------------ */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const now = Date.now();

    // Settings universe (coins)
    const settings = await getSettings();
    const settingsBases = (settings.coinUniverse ?? [])
      .map((s: string) => norm(s))
      .filter(Boolean);

    // Available pairs from settings: verified crosses + USDT legs
    const available: PairAvailability = await pairsFromSettings(settingsBases, {
      verify: async (syms) => verifySymbolsMulti(syms),
      preferVerifiedUsdt: true,
    });

    // Client selection: accept either coins (→ USDT legs) or explicit symbols
    const tokens = parseListParam(url, ["coins", "pairs"]); // e.g., ["BTC","ETH"] or ["ETHBTC","BTCUSDT"]
    const verifiedSet = new Set<string>(available.all ?? []);
    const allowUnverified = String(url.searchParams.get("allowUnverified") ?? "")
      .trim().toLowerCase() === "true";

    let selectedSymbols: string[];

    const tokensLookLikeSymbols =
      tokens.length > 0 && tokens.every(t => /^[A-Z0-9]{5,}$/.test(t));

    if (!tokens.length) {
      // default: all USDT legs from settings
      selectedSymbols = available.usdt.slice();
    } else if (tokensLookLikeSymbols) {
      // symbols path — allow unverified when asked; else keep only verified (when we have a set)
      selectedSymbols = (allowUnverified || !verifiedSet.size)
        ? tokens.slice()
        : tokens.filter(s => verifiedSet.has(s));
    } else {
      // coins path — expand to USDT legs and keep only verified when possible (or all if allowUnverified)
      const legs = usdtLegsFromCoins(tokens);
      selectedSymbols = (allowUnverified || !verifiedSet.size)
        ? legs
        : legs.filter(s => verifiedSet.has(s));
    }

    const windowKey = parseWindow(url.searchParams.get("window"));
    const binsN = parseBinsParam(url.searchParams.get("bins"), 128);
    const appSessionId = (url.searchParams.get("sessionId") ?? "ui").slice(0, 64);

    // No selection → empty response but advertise availability for the UI
    if (!selectedSymbols.length) {
      return NextResponse.json({
        ok: true,
        symbols: [],
        out: {},
        available,
        selected: [],
        window: windowKey,
        ts: now,
        timing: settings.timing ?? undefined,
      });
    }

    /* -------------------- per-symbol processing (concurrent) -------------------- */

    const tasks = selectedSymbols.map(async (symbol) => {
      const { base, quote } = splitSymbol(symbol);
      try {
        // Ticker (for % and price fallback)
        const t24 = await fetchTicker24h(symbol);
        const lastPriceFromTicker = Number((t24 as any)?.lastPrice ?? (t24 as any)?.weightedAvgPrice ?? NaN);
        const pct24h = Number((t24 as any)?.priceChangePercent ?? 0) || 0;

        // Points: klines + orderbook snapshot
        const points: MarketPoint[] = await loadPoints(symbol, windowKey, binsN);
        if (!points.length || !Number.isFinite(points[points.length - 1]?.price)) {
          return [symbol, { ok: false, error: "no market data", n: 0, bins: binsN }] as const;
        }

        const lastPoint = points[points.length - 1];
        const lastPrice = Number.isFinite(lastPoint.price) ? lastPoint.price : lastPriceFromTicker;

        const opening = ensureOpening(points, lastPriceFromTicker, now);
        if (!(opening.benchmark > 0)) {
          return [symbol, { ok: false, error: "opening≤0", n: points.length, bins: binsN }] as const;
        }

        // Session (stateful) + IDHR/FM
        const ss = getOrInitSymbolSession(appSessionId, symbol, opening.benchmark, now);

        const idhr = computeIdhrBinsN(points, opening, {}, binsN);
        const fm = computeFM(points, opening, { totalBins: binsN });

        const gfmReturns = Number(fm?.gfm ?? 0);
        const gfmCalcPrice = opening.benchmark * Math.exp(gfmReturns);

        const upd = updateSymbolSession(ss, lastPrice, lastPoint.ts ?? now, gfmCalcPrice, pct24h);
        const streams = exportStreams(ss);

        // Fresh-open heuristic (avoid polluting DB)
        const looksLikeFreshOpen =
          ss.priceMin === ss.openingPrice &&
          ss.priceMax === ss.openingPrice &&
          ss.shifts === 0 &&
          ss.swaps === 0;

        try {
          await upsertSession(
            { base, quote, window: windowKey, appSessionId },
            ss,
            looksLikeFreshOpen,
            !!upd?.isShift,
            upd?.gfmDeltaAbsPct ?? 0
          );
        } catch {}

        const cardOpeningPct = ss.snapPrev?.pct24h ?? pct24h;
        const cardLivePct = ss.snapCur?.pct24h ?? pct24h;
        const cardLiveDrv = ss.snapCur?.pctDrv ?? 0;

        const out = {
          ok: true,
          n: points.length,
          bins: binsN,
          window: windowKey,
          cards: {
            opening: { benchmark: ss.openingPrice, pct24h: cardOpeningPct },
            live:    { benchmark: ss.snapCur?.price ?? lastPrice, pct24h: cardLivePct, pct_drv: cardLiveDrv },
          },
          fm: {
            gfm_ref_price: ss.gfmRefPrice ?? undefined,
            gfm_calc_price: ss.gfmCalcPrice ?? gfmCalcPrice,
            sigma: fm?.sigmaGlobal ?? idhr?.sigmaGlobal ?? 0,
            zAbs: fm?.zMeanAbs ?? 0,
            vInner: fm?.vInner ?? 0,
            vOuter: fm?.vOuter ?? 0,
            inertia: fm?.inertia ?? 0,
            disruption: fm?.disruption ?? 0,
            nuclei: (fm?.nuclei ?? []).map((n: any, i: number) => ({ binIndex: Number(n?.key?.idhr ?? i) })),
          },
          gfmDelta: { absPct: upd?.gfmDeltaAbsPct ?? 0, anchorPrice: ss.gfmRefPrice ?? null, price: lastPrice },
          swaps: ss.swaps,
          shifts: { nShifts: ss.shifts, timelapseSec: Math.floor((now - ss.openingTs) / 1000), latestTs: lastPoint.ts ?? now },
          shift_stamp: !!upd?.isShift,
          sessionStats: { priceMin: ss.priceMin, priceMax: ss.priceMax, benchPctMin: ss.benchPctMin, benchPctMax: ss.benchPctMax },
          streams,
          hist: { counts: idhr?.counts ?? [] },
          meta: { uiEpoch: upd?.uiEpoch ?? ss.uiEpoch },
          lastUpdateTs: lastPoint.ts ?? now,
        };
        return [symbol, out] as const;
      } catch (err: any) {
        return [symbol, { ok: false, error: String(err?.message ?? err) }] as const;
      }
    });

    const settled = await Promise.allSettled(tasks);
    const out: Record<string, any> = {};
    for (const s of settled) {
      if (s.status === "fulfilled") {
        const [sym, val] = s.value;
        out[sym] = val;
      }
    }

    const symbols = Object.keys(out);
    return NextResponse.json({
      ok: true,
      symbols,
      out,
      available,
      selected: selectedSymbols,
      window: windowKey,
      ts: now,
      timing: settings.timing ?? undefined,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
