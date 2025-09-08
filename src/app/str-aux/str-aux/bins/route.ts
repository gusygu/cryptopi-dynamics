// src/app/api/str-aux/bins/route.ts
import { NextResponse } from 'next/server';

// ---- shared types + analytics ----------------------------------------------
import type { WindowKey, MarketPoint, OpeningExact } from '@/str-aux/types';
import { computeIdhrBinsN, computeFM } from '@/str-aux/idhr';
import {
  getOrInitSymbolSession,
  updateSymbolSession,
  exportStreams,
} from '@/str-aux/session';
import { upsertSession } from '@/lib/str-aux/sessionDb';

// ---- live data (orderbook + klines + 24h ticker) ---------------------------
import {
  fetchOrderBookPoint,
  fetchKlinesPoints,
  fetchTicker24h,
} from '@/sources/binance';

// ---------------------------------------------------------------------------
// helpers

type Interval = '1m' | '5m' | '15m' | '30m' | '1h';

// UI uses: '30m' | '1h' | '3h'
// Binance has no '3h' → pull 5m with plenty of bars
function windowToInterval(w: WindowKey): { interval: Interval; klineLimit: number } {
  switch (w) {
    case '30m': return { interval: '1m',  klineLimit: 240 }; // ~4h of minutes
    case '1h':  return { interval: '1m',  klineLimit: 360 }; // ~6h of minutes
    case '3h':  return { interval: '5m',  klineLimit: 240 }; // ~20h of 5m bars
    default:    return { interval: '1m',  klineLimit: 240 };
  }
}

function parseWindow(s: string | null | undefined): WindowKey {
  const v = (s ?? '30m').toLowerCase();
  return (v === '30m' || v === '1h' || v === '3h') ? (v as WindowKey) : '30m';
}

function toSymbol(baseOrPair: string) {
  const u = baseOrPair.trim().toUpperCase();
  return u.endsWith('USDT') ? u : `${u}USDT`;
}

function parseCoinsParam(s: string | null | undefined): string[] {
  const raw = (s ?? process.env.NEXT_PUBLIC_COINS ?? 'BTC ETH BNB SOL ADA XRP')
    .toUpperCase()
    .split(/[,\s]+/)
    .map(v => v.trim())
    .filter(Boolean);
  return raw.map(toSymbol);
}

function parseBinsParam(s: string | null | undefined, dflt = 128) {
  const n = Number(s ?? dflt);
  return Number.isFinite(n) && n > 0 ? Math.min(2048, Math.max(8, Math.floor(n))) : dflt;
}

function ensureOpening(points: MarketPoint[], fallbackPrice: number, tsNow: number): OpeningExact {
  const p0 = Number(points[0]?.price ?? fallbackPrice ?? 0);
  return {
    benchmark: p0 > 0 ? p0 : 0,
    pct24h: 0,
    id_pct: 0,
    ts: Number(points[0]?.ts ?? tsNow),
    layoutHash: 'str-aux:idhr-128',
  };
}

// Prefer a live orderbook mid snapshot; fall back to recent klines
async function loadPoints(symbol: string, windowKey: WindowKey, binsN: number): Promise<MarketPoint[]> {
  const { interval, klineLimit } = windowToInterval(windowKey);

  // Try a very-fresh orderbook mid
  let pts: MarketPoint[] = [];
  try {
    const p = await fetchOrderBookPoint(symbol, 100);
    if (Number.isFinite(p.price) && p.price > 0) pts.push(p);
  } catch { /* ignore */ }

  // Fill with historical klines for density
  try {
    const klPts = await fetchKlinesPoints(symbol, interval, Math.max(klineLimit, binsN * 2));
    if (Array.isArray(klPts) && klPts.length) {
      pts = [...klPts, ...pts];
    }
  } catch { /* ignore */ }

  // Dedup by ts, sorted asc
  const seen = new Set<number>();
  const uniq: MarketPoint[] = [];
  for (const p of pts.sort((a, b) => a.ts - b.ts)) {
    if (!seen.has(p.ts)) {
      seen.add(p.ts);
      uniq.push(p);
    }
  }
  return uniq;
}

// ---------------------------------------------------------------------------
// GET

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const coins = parseCoinsParam(url.searchParams.get('coins'));
    const windowKey = parseWindow(url.searchParams.get('window'));
    const binsN = parseBinsParam(url.searchParams.get('bins'), 128);
    const appSessionId = (url.searchParams.get('sessionId') ?? 'ui').slice(0, 64);
    const now = Date.now();

    if (!coins.length) {
      return NextResponse.json({ ok: true, symbols: [], out: {}, window: windowKey, ts: now });
    }

    const out: Record<string, any> = {};

    for (const symbol of coins) {
      const base = symbol.replace(/USDT$/i, '');
      try {
        // (1) snapshot: last price + 24h for labels / quick UI
        const t24 = await fetchTicker24h(symbol); // -> { price, pct24h }
        const lastPriceFromTicker = Number(t24?.price ?? NaN);
        const pct24h = Number(t24?.pct24h ?? 0);

        // (2) points: orderbook mid (fresh) + klines (dense)
        const points = await loadPoints(symbol, windowKey, binsN);

        if (!points.length || !Number.isFinite(points[points.length - 1]?.price)) {
          out[symbol] = { ok: false, error: 'no market data', n: 0, bins: binsN };
          continue;
        }

        const lastPoint = points[points.length - 1];
        const lastPrice = Number.isFinite(lastPoint.price) ? lastPoint.price : lastPriceFromTicker;

        // (3) opening + session
        const opening = ensureOpening(points, lastPriceFromTicker, now);
        if (!(opening.benchmark > 0)) {
          out[symbol] = { ok: false, error: 'opening≤0', n: points.length, bins: binsN };
          continue;
        }

        // Session orchestration (GFMr/GFMc, swaps, K-cycle shifts, min/max, streams)
        const ss = getOrInitSymbolSession(appSessionId, symbol, opening.benchmark, now);

        // (4) IDHR + FM
        const idhr = computeIdhrBinsN(points, opening, {}, binsN);
        const fm = computeFM(points, opening, { totalBins: binsN });

        // Convert FM.gfm (log return) to price-space (GFMc)
        const gfmReturns = Number(fm?.gfm ?? 0);            // log(px/p0)
        const gfmCalcPrice = opening.benchmark * Math.exp(gfmReturns);

        // (5) update session with current snapshot
        const upd = updateSymbolSession(ss, lastPrice, lastPoint.ts ?? now, gfmCalcPrice, pct24h);
        const streams = exportStreams(ss);

        // (6) persist (best-effort). openingStamp only at cold-start-ish state.
        const looksLikeFreshOpen =
          ss.priceMin === ss.openingPrice &&
          ss.priceMax === ss.openingPrice &&
          ss.shifts === 0 &&
          ss.swaps === 0;

        try {
          await upsertSession(
            { base, quote: 'USDT', window: windowKey, appSessionId },
            ss,
            /* openingStamp */ looksLikeFreshOpen,
            /* shiftStamp   */ !!upd?.isShift,
            /* gfmDelta     */ upd?.gfmDeltaAbsPct ?? 0
          );
        } catch { /* ignore in dev */ }

        // (7) UI shape (keeps the existing contract, adds cards.*)
        out[symbol] = {
          ok: true,
          n: points.length,
          bins: binsN,
          window: windowKey,

          // --- cards for UI tiles ------------------------------------------------
          cards: {
            opening: {
              benchmark: ss.openingPrice,       // opening card: big number
              pct24h: ss.snapPrev?.pct24h ?? pct24h, // small caption (at open)
            },
            live: {
              benchmark: ss.snapCur?.price ?? lastPrice,   // live-market benchmark
              pct24h: ss.snapCur?.pct24h ?? pct24h,        // from ticker
              pct_drv: ss.snapCur?.pctDrv ?? 0,            // from session dynamics
            },
          },

          // --- FM / GFM block ----------------------------------------------------
          fm: {
            gfm_ref_price: ss.gfmRefPrice ?? undefined,      // GFMr anchor
            gfm_calc_price: ss.gfmCalcPrice ?? gfmCalcPrice, // GFMc (live)
            sigma: fm?.sigmaGlobal ?? idhr?.sigmaGlobal ?? 0,
            zAbs: fm?.zMeanAbs ?? 0,
            vInner: fm?.vInner ?? 0,
            vOuter: fm?.vOuter ?? 0,
            inertia: fm?.inertia ?? 0,
            disruption: fm?.disruption ?? 0,
            nuclei: (fm?.nuclei ?? []).map((n: any, i: number) => ({
              binIndex: Number(n?.key?.idhr ?? i),          // stable highlight in histogram
            })),
          },

          // Δ vs GFMr (abs %), for the badge
          gfmDelta: {
            absPct: upd?.gfmDeltaAbsPct ?? 0,
            anchorPrice: ss.gfmRefPrice ?? null,
            price: lastPrice,
          },

          // sessions + shifts
          swaps: ss.swaps,
          shifts: {
            nShifts: ss.shifts,
            timelapseSec: Math.floor((now - ss.openingTs) / 1000),
            latestTs: lastPoint.ts ?? now,
          },
          shift_stamp: !!upd?.isShift,

          // session min/max + extrema (session-bounded)
          sessionStats: {
            priceMin: ss.priceMin,
            priceMax: ss.priceMax,
            benchPctMin: ss.benchPctMin,
            benchPctMax: ss.benchPctMax,
          },

          streams,
          hist: { counts: idhr?.counts ?? [] },

          meta: { uiEpoch: upd?.uiEpoch ?? ss.uiEpoch },
          lastUpdateTs: lastPoint.ts ?? now,
        };
      } catch (err: any) {
        console.error(`coin failed ${base}`, err?.message ?? err);
        out[symbol] = { ok: false, error: String(err?.message ?? err) };
      }
    }

    // UI contract: { symbols, out, window, ts }
    const symbols = Object.keys(out);
    return NextResponse.json({ ok: true, symbols, out, window: windowKey, ts: now });
  } catch (err: any) {
    console.error('bins route failed', err);
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
