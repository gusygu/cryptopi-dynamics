// src/app/api/str-aux/bins/route.ts
import { NextResponse } from "next/server";

// ---- types + analytics ------------------------------------------------------
import type { WindowKey, MarketPoint, OpeningExact } from "@/str-aux/types";
import { computeIdhrBinsN, computeFM } from "@/str-aux/idhr";
import { computeShiftSwap } from "@/str-aux/shift_swap";
import { getOrInitSymbolSession, updateSymbolSession, exportStreams } from "@/str-aux/session";
import { upsertSession } from "@/lib/str-aux/sessionDb";

// ---- live data (orderbook + klines + 24h ticker) ---------------------------
import {
  fetchOrderBookPoint,   // returns { ts, price(mid), volume }
  fetchKlinesPoints,     // returns MarketPoint[]
  fetchTicker24h,        // returns { price, pct24h } or native binance shape
} from "@/sources/binance";

// ---- settings ---------------------------------------------------------------
import { getAll as getSettings } from "@/lib/settings/server";
import { normalizeCoin } from "@/lib/markets/pairs";

/* -------------------------------------------------------------------------- */

type Interval = "1m" | "5m" | "15m" | "30m" | "1h";

// UI uses: '30m' | '1h' | '3h'
// Binance has no '3h' → pull 5m with plenty of bars
function windowToInterval(w: WindowKey): { interval: Interval; klineLimit: number } {
  switch (w) {
    case "30m": return { interval: "1m",  klineLimit: 240 }; // ~4h of minutes
    case "1h":  return { interval: "1m",  klineLimit: 360 }; // ~6h of minutes
    case "3h":  return { interval: "5m",  klineLimit: 240 }; // ~20h of 5m bars
    default:    return { interval: "1m",  klineLimit: 240 };
  }
}

function parseWindow(s: string | null | undefined): WindowKey {
  const v = (s ?? "30m").toLowerCase();
  return (v === "30m" || v === "1h" || v === "3h") ? (v as WindowKey) : "30m";
}

function parseBinsParam(s: string | null | undefined, dflt = 128) {
  const n = Number(s ?? dflt);
  return Number.isFinite(n) && n > 0 ? Math.min(2048, Math.floor(n)) : dflt;
}

/** Parse `coins=` list (preferred) or `pairs=` (explicit symbols) */
function parseListParam(url: URL, keys = ["coins", "pairs"]): string[] {
  for (const k of keys) {
    const raw = String(url.searchParams.get(k) ?? "").trim();
    if (!raw) continue;
    return raw.toUpperCase().split(/[,\s]+/).map(v => v.trim()).filter(Boolean);
  }
  return [];
}

/** split symbol using common quote suffixes, fallback heuristic otherwise */
const KNOWN_QUOTES = ["USDT","BTC","ETH","BNB","FDUSD","BUSD","TUSD","USDC","TRY","EUR","BRL","GBP"];
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

/* --------------------- preview: coins → all pairs → verify ------------------ */

/** cartesian product of coins (ordered), excluding base==quote */
function symbolsFromCoins(coins: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < coins.length; i++) {
    for (let j = 0; j < coins.length; j++) {
      if (i === j) continue;
      out.push(`${coins[i]}${coins[j]}`.toUpperCase());
    }
  }
  return Array.from(new Set(out));
}

/** Use local preview routes to verify which symbols exist on Binance */
async function getPreviewVerifiedSymbols(origin: string, coins: string[]): Promise<string[]> {
  const query = coins.join(",");
  // 1) Try GET /api/preview/binance?coins=...
  try {
    const r = await fetch(`${origin}/api/preview/binance?coins=${encodeURIComponent(query)}`, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json() as any;
      if (j?.ok !== false && Array.isArray(j?.symbols) && j.symbols.length) {
        return Array.from(new Set(j.symbols.map((s: any) => String(s).toUpperCase())));
      }
    }
  } catch { /* continue */ }

  // 2) Try POST /api/preview/symbols  { coins }
  try {
    const r = await fetch(`${origin}/api/preview/symbols`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ coins }),
    });
    if (r.ok) {
      const j = await r.json() as any;
      if (j?.ok !== false && Array.isArray(j?.symbols) && j.symbols.length) {
        return Array.from(new Set(j.symbols.map((s: any) => String(s).toUpperCase())));
      }
    }
  } catch { /* continue */ }

  return []; // preview unavailable
}

/* --------------------- market points (orderbook + klines) ------------------- */

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

// Prefer a live orderbook mid snapshot; fall back to recent klines
async function loadPoints(symbol: string, windowKey: WindowKey, binsN: number): Promise<MarketPoint[]> {
  const { interval, klineLimit } = windowToInterval(windowKey);

  // fresh orderbook mid (single point)
  const pts: MarketPoint[] = [];
  try {
    const p = await fetchOrderBookPoint(symbol, 100);
    if (Number.isFinite(p?.price) && p.price > 0) pts.push(p);
  } catch { /* ignore */ }

  // dense historical klines
  try {
    const klPts = await fetchKlinesPoints(symbol, interval, Math.max(klineLimit, binsN * 2));
    if (Array.isArray(klPts) && klPts.length) pts.unshift(...klPts);
  } catch { /* ignore */ }

  // dedup + sort
  const seen = new Set<number>();
  const uniq: MarketPoint[] = [];
  for (const p of pts.sort((a, b) => a.ts - b.ts)) {
    if (!seen.has(p.ts)) { seen.add(p.ts); uniq.push(p); }
  }
  return uniq;
}

/* ---------------------------------- GET ------------------------------------ */

export const dynamic = "force-dynamic";

/**
 * Selection & availability (this patch):
 *   selected coins  → all possible pairs (base≠quote) → intersect with preview → available symbols
 *   Then run *unchanged* analytics/persistence for those symbols.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const origin = url.origin;
    const now = Date.now();

    // Settings universe (coins)
    const settings = await getSettings();
    const settingsBases = (settings.coinUniverse ?? [])
      .map((s: string) => normalizeCoin(s))
      .filter(Boolean)
      .map((s: string) => s.toUpperCase());

    // Client selection (coins preferred). If none provided, use settings.
    const coinsFromQuery = parseListParam(url, ["coins"]).map(s => s.toUpperCase());
    const coins = (coinsFromQuery.length ? coinsFromQuery : settingsBases)
      .filter(Boolean);
    const coinsSet = new Set(coins);

    // Build *all* possible symbols (ordered, base≠quote) from the selection
    const candidateSymbols = symbolsFromCoins(coins);

    // Verify against preview routes
    const previewSymbols = await getPreviewVerifiedSymbols(origin, coins);
    const previewSet = new Set(previewSymbols);

    // If preview is empty (network/offline), keep the candidates so UI still shows something
    const availableAll = (previewSet.size
      ? candidateSymbols.filter(s => previewSet.has(s))
      : candidateSymbols);

    // For back-compat: expose USDT subset too, but DO NOT restrict selection to it
    const availableUsdt = availableAll.filter(s => s.endsWith("USDT"));

    // Selected symbols for this request = all available for the chosen coins
    const selectedSymbols = availableAll.slice();

    const windowKey = parseWindow(url.searchParams.get("window"));
    const binsN = parseBinsParam(url.searchParams.get("bins"), 128);
    const appSessionId = (url.searchParams.get("sessionId") ?? "ui").slice(0, 64);

    // Shift/swap params (robust read from settings)
    const settingsAny = settings as any;
    const epsilonPct = Number(
      url.searchParams.get("epsilonPct") ??
      (settingsAny?.strAux?.epsilonPct) ??
      0.2
    );
    const secondaryMs = Number(url.searchParams.get("secondaryMs") ?? settings?.timing?.autoRefreshMs ?? 2500);

    // No selection → respond with availability only
    if (!selectedSymbols.length) {
      return NextResponse.json({
        ok: true,
        symbols: [],
        out: {},
        available: { usdt: availableUsdt, all: availableAll },
        selected: [],
        window: windowKey,
        ts: now,
        timing: settings.timing ?? undefined,
      });
    }

    /* -------------------- per-symbol processing (unchanged) ------------------- */
    const out: Record<string, any> = {};

    for (const symbol of selectedSymbols) {
      const { base, quote } = splitSymbol(symbol);
      try {
        // (1) snapshot: last price + 24h for labels / quick UI
        const t24 = await fetchTicker24h(symbol);
        const lastPriceFromTicker = Number(
          (t24 as any)?.lastPrice ??
          (t24 as any)?.price ??
          (t24 as any)?.weightedAvgPrice ??
          NaN
        );
        const pct24h = Number(
          (t24 as any)?.priceChangePercent ??
          (t24 as any)?.pct24h ??
          0
        ) || 0;

        // (2) points: orderbook mid (fresh) + klines (dense)
        const points = await loadPoints(symbol, windowKey, binsN);

        if (!points.length || !Number.isFinite(points[points.length - 1]?.price)) {
          out[symbol] = { ok: false, error: "no market data", n: 0, bins: binsN };
          continue;
        }

        const lastPoint = points[points.length - 1];
        const lastPrice = Number.isFinite(lastPoint.price) ? lastPoint.price : lastPriceFromTicker;

        // (3) opening + session
        const opening = ensureOpening(points, lastPriceFromTicker, now);
        if (!(opening.benchmark > 0)) {
          out[symbol] = { ok: false, error: "opening≤0", n: points.length, bins: binsN };
          continue;
        }

        // Session orchestration (GFMr/GFMc, swaps, K-cycle shifts, min/max, streams)
        const ss = getOrInitSymbolSession(appSessionId, symbol, opening.benchmark, now);

        // (4) IDHR + FM  (tendency vectors + inertia/disruption included)
        const idhr = computeIdhrBinsN(points, opening, {}, binsN);
        const fm = computeFM(points, opening, { totalBins: binsN });

        // Convert FM.gfm (log return) to price-space (GFMc)
        const gfmReturns = Number(fm?.gfm ?? 0);            // log(px/p0)
        const gfmCalcPrice = opening.benchmark * Math.exp(gfmReturns);

        // (5) update session with current snapshot
        const upd = updateSymbolSession(ss, lastPrice, lastPoint.ts ?? now, gfmCalcPrice, pct24h);
        const streams = exportStreams(ss);

        // (6) compute shift/swap overlays
        const gfmr = ss.gfmRefPrice ?? opening.benchmark;
        const gfm_delta_pct = gfmr > 0 ? ((lastPrice / gfmr) - 1) * 100 : 0;          // signed
        const id_pct = ((lastPrice / opening.benchmark) - 1) * 100;                   // benchPct (signed)
        const overlay = computeShiftSwap(appSessionId, {
          gfm_delta_pct,
          id_pct,
          epsilon: Math.abs(epsilonPct),      // in %
          secondaryMs,
        });

        // (7) persist (best-effort). openingStamp only at cold-start-ish state.
        const looksLikeFreshOpen =
          ss.priceMin === ss.openingPrice &&
          ss.priceMax === ss.openingPrice &&
          ss.shifts === 0 &&
          ss.swaps === 0;

        try {
          await upsertSession(
            { base, quote, window: windowKey, appSessionId },
            ss,
            /* openingStamp */ looksLikeFreshOpen,
            /* shiftStamp   */ !!upd?.isShift || !!overlay?.shift_stamp,
            /* gfmDelta     */ Math.abs(gfm_delta_pct)
          );
        } catch { /* ignore in dev */ }

        // (8) response shape (unchanged)
        out[symbol] = {
          ok: true,
          n: points.length,
          bins: binsN,
          window: windowKey,

          cards: {
            opening: {
              benchmark: ss.openingPrice,
              pct24h: ss.snapPrev?.pct24h ?? pct24h,
            },
            live: {
              benchmark: ss.snapCur?.price ?? lastPrice,
              pct24h: ss.snapCur?.pct24h ?? pct24h,
              pct_drv: ss.snapCur?.pctDrv ?? 0,
            },
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
            nuclei: (fm?.nuclei ?? []).map((n: any, i: number) => ({
              binIndex: Number(n?.key?.idhr ?? i),
            })),
          },

          gfmDelta: {
            absPct: Math.abs(gfm_delta_pct),
            anchorPrice: ss.gfmRefPrice ?? null,
            price: lastPrice,
          },

          swaps: ss.swaps,
          shifts: {
            nShifts: ss.shifts,
            timelapseSec: Math.floor((now - ss.openingTs) / 1000),
            latestTs: lastPoint.ts ?? now,
          },

          overlay: {
            shift_stamp: !!overlay.shift_stamp,
            shift_n: overlay.shift_n,
            shift_hms: overlay.shift_hms,     // "hh:mm:ss"
            swap_n: overlay.swap_n,
            swap_sign: overlay.swap_sign,     // "ascending" | "descending" | null
            swap_hms: overlay.swap_hms,       // "hh:mm:ss"
          },

          sessionStats: {
            priceMin: ss.priceMin,
            priceMax: ss.priceMax,
            benchPctMin: ss.benchPctMin,
            benchPctMax: ss.benchPctMax,
          },

          streams,
          hist: { counts: idhr?.counts ?? [] },

          meta: {
            uiEpoch: upd?.uiEpoch ?? ss.uiEpoch,
            epsilonPct,
            secondaryMs,
          },
          lastUpdateTs: lastPoint.ts ?? now,
        };
      } catch (err: any) {
        out[symbol] = { ok: false, error: String(err?.message ?? err) };
      }
    }

    const symbols = Object.keys(out);
    return NextResponse.json({
      ok: true,
      symbols,
      out,
      // availability (now truly reflects preview∩candidates)
      available: {
        usdt: availableUsdt,
        all: availableAll,
      },
      selected: selectedSymbols,
      window: windowKey,
      ts: now,
      timing: settings.timing ?? undefined,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
