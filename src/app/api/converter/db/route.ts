// src/app/api/converter/db/route.ts
import { NextRequest, NextResponse } from "next/server";

import { wireConverterSources } from "@/converters/Converter.server";
import { buildDomainVM } from "@/converters/Converter.server";
import { makeMatricesHttpProvider } from "@/converters/providers/matrices.http";
import { makeMeaModuleProvider } from "@/converters/providers/meaaux.module";
import { makeStrDbProvider } from "@/converters/providers/straux.db";
import { makeCinDbProvider } from "@/converters/providers/cinaux.db";

import { computeMeaAux } from "@/lib/tiers/meaAux";
import { db as strAuxDb } from "@/lib/str-aux/db";
import { db } from "@/core/db";

function parseCsv(q?: string | null): string[] {
  return (q ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl;
    const Ca = (url.searchParams.get("Ca") || "").toUpperCase();
    const Cb = (url.searchParams.get("Cb") || "").toUpperCase();

    const coinsParam = parseCsv(url.searchParams.get("coins"));
    const envCoins = (process.env.NEXT_PUBLIC_COINS ?? "BTC,ETH,BNB,SOL,ADA,DOGE,USDT,PEPE,BRL")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const coins = coinsParam.length ? coinsParam : envCoins;

    const candParam = parseCsv(url.searchParams.get("candidates"));
    const candidatesRaw = candParam.length ? candParam : coins;
    const candidates = candidatesRaw
      .filter((c) => coins.includes(c))
      .filter((c) => c !== Ca && c !== Cb)
      .slice(0, 32);

    // ---- Providers ----
    const matrices = makeMatricesHttpProvider(req.nextUrl.origin);

    // MEA (DB-derived from latest benchmark snapshots via id_pct fraction)
    async function mea_getMeaForPair(pair: { base: string; quote: string }) {
      const coinsU = coins;
      const rTs = await db.query<{ ts_ms: string | number }>(
        `SELECT DISTINCT ts_ms FROM dyn_matrix_values WHERE matrix_type='benchmark' ORDER BY ts_ms DESC LIMIT 2`
      );
      const stamps = rTs.rows.map((r) => Number(r.ts_ms)).filter((n) => Number.isFinite(n));
      let idp = 0;
      if (stamps.length >= 2) {
        const [latest, previous] = [stamps[0], stamps[1]];
        const rows = await db.query<{ base: string; quote: string; value: string | number; ts_ms: string | number }>(
          `SELECT base, quote, value, ts_ms FROM dyn_matrix_values WHERE matrix_type='benchmark' AND ts_ms IN ($1,$2)`,
          [latest, previous]
        );
        const newer = new Map<string, number>();
        const older = new Map<string, number>();
        const key = (b: string, q: string) => `${String(b).toUpperCase()}|${String(q).toUpperCase()}`;
        for (const r of rows.rows) {
          const k = key(r.base, r.quote);
          const v = Number(r.value);
          if (!Number.isFinite(v)) continue;
          if (Number(r.ts_ms) === latest) newer.set(k, v);
          else older.set(k, v);
        }
        const kpair = key(pair.base, pair.quote);
        const nv = newer.get(kpair);
        const ov = older.get(kpair);
        if (nv != null && ov != null && ov !== 0) idp = (nv - ov) / ov;
      }
      const mea = computeMeaAux(idp);
      // Use signed weight and written tier name from tiers.ts ranks
      return { value: mea.weight, tier: mea.name ?? mea.tier ?? "-" };
    }
    const mea = makeMeaModuleProvider({ getMeaForPair: mea_getMeaForPair } as any);

    // STR (DB-backed) deps
    async function str_getIdPctHistory(from: string, to: string, lastN = 6) {
      const r = await db.query<{ value: string | number }>(
        `select value from dyn_matrix_values where matrix_type='id_pct' and base=$1 and quote=$2 order by ts_ms desc limit $3`,
        [from, to, lastN]
      );
      return r.rows.map((x) => Number(x.value ?? 0));
    }
    async function str_getGfm() {
      const doc = await strAuxDb.getLatest({ base: "BTC", quote: "USDT", window: "30m", appSessionId: "dyn" });
      return Number((doc as any)?.stats?.gfm ?? 0);
    }
    async function str_getShift() {
      const doc = await strAuxDb.getLatest({ base: "BTC", quote: "USDT", window: "30m", appSessionId: "dyn" });
      return Number((doc as any)?.stats?.deltaGfm ?? 0);
    }
    async function str_getVTendency(pair: { base: string; quote: string }) {
      const doc = await strAuxDb.getLatest({ base: pair.base, quote: pair.quote, window: "30m", appSessionId: "dyn" });
      const s = (doc as any)?.stats ?? {};
      return Number((s.vOuter ?? 0) - (s.vInner ?? 0));
    }
    const str = makeStrDbProvider({
      getIdPctHistory: str_getIdPctHistory,
      getGfm: str_getGfm,
      getShift: str_getShift,
      getVTendency: str_getVTendency,
    });

    // CIN (DB-backed)
    async function cin_getLatestCycleTs(appSessionId: string) {
      const r = await db.query<{ ts: string }>(
        `select max(cycle_ts)::text as ts from cin_aux_cycle where app_session_id=$1`,
        [appSessionId]
      );
      const ts = Number(r.rows[0]?.ts || 0);
      return Number.isFinite(ts) && ts > 0 ? ts : null;
    }
    async function cin_getWallet(symbol: string, appSessionId = "dyn") {
      const ts = await cin_getLatestCycleTs(appSessionId);
      if (!ts) return 0;
      const r = await db.query<{ qty: string }>(
        `select qty from wallet_snapshots where app_session_id=$1 and cycle_ts=$2 and symbol=$3`,
        [appSessionId, ts, symbol]
      );
      const v = Number(r.rows[0]?.qty || 0);
      return Number.isFinite(v) ? v : 0;
    }
    async function cin_getCinStats(symbols: string[], appSessionId = "dyn") {
      const ts = await cin_getLatestCycleTs(appSessionId);
      if (!ts) return [] as any[];
      const r = await db.query<any>(
        `select symbol, imprint_cycle_usdt, luggage_cycle_usdt, imprint_app_session_usdt, luggage_app_session_usdt
         from v_cin_aux where app_session_id=$1 and cycle_ts=$2 and symbol = any($3) order by symbol`,
        [appSessionId, ts, symbols]
      );
      return r.rows.map((row: any) => ({
        symbol: row.symbol,
        session_imprint: Number(row.imprint_app_session_usdt ?? 0),
        session_luggage: Number(row.luggage_app_session_usdt ?? 0),
        cycle_imprint: Number(row.imprint_cycle_usdt ?? 0),
        cycle_luggage: Number(row.luggage_cycle_usdt ?? 0),
      }));
    }
    const cin = makeCinDbProvider({ getWallet: cin_getWallet, getCinStats: cin_getCinStats });

    // Helper: derivatives for pair to derive shifts/swaps
    async function getDerivativesForPair(from: string, to: string, lastN = 16) {
      // Try pct_drv first with timestamps
      const r1 = await db
        .query<{ ts_ms: string | number; value: string | number }>(
          `select ts_ms, value from dyn_matrix_values where matrix_type='pct_drv' and base=$1 and quote=$2 order by ts_ms desc limit $3`,
          [from, to, lastN]
        )
        .catch(() => ({ rows: [] as Array<{ ts_ms: string | number; value: string | number }> }));
      if (r1.rows.length) {
        return r1.rows
          .map((x) => ({ ts_ms: Number(x.ts_ms), value: Number(x.value ?? 0) }))
          .reverse()
          .map((p) => p.value);
      }
      // Fallback: derive from id_pct history
      const idRows = await db
        .query<{ ts_ms: string | number; value: string | number }>(
          `select ts_ms, value from dyn_matrix_values where matrix_type='id_pct' and base=$1 and quote=$2 order by ts_ms desc limit $3`,
          [from, to, Math.max(lastN + 1, 8)]
        )
        .catch(() => ({ rows: [] as Array<{ ts_ms: string | number; value: string | number }> }));
      const seq = idRows.rows
        .map((x) => ({ ts_ms: Number(x.ts_ms), value: Number(x.value ?? 0) }))
        .reverse();
      const drv: number[] = [];
      for (let i = 1; i < seq.length; i++) drv.push(seq[i].value - seq[i - 1].value);
      return drv.slice(-lastN);
    }

    // Wire & build VM
    wireConverterSources({ matrices, mea, str, cin });
    const vm = await buildDomainVM({ Ca, Cb, candidates, coinsUniverse: coins, histLen: 64 });

    // Augment VM with STR shifts/swaps counts and gfmAbsPct (Δ%) for the selected pair from DB
    try {
      const drv = await getDerivativesForPair(Ca, Cb, 24);
      const signs = drv.map((d) => Math.sign(d));
      let flips = 0;
      let prevNZ = 0;
      for (const s of signs) { if (s !== 0 && prevNZ !== 0 && s !== prevNZ) flips++; if (s !== 0) prevNZ = s; }
      const strPanel = (vm as any).metricsPanel?.str ?? (vm as any).panels?.str;
      // compute gfmAbsPct from DB shift if available
      const dbShift = Number(strPanel?.shift ?? NaN);
      const gfmAbsPct = Number.isFinite(dbShift) ? Math.abs(dbShift) * 100 : undefined;
      if (strPanel) {
        strPanel.shifts = flips;
        strPanel.swaps = flips; // proxy until a dedicated swaps metric exists
        if (gfmAbsPct != null) (strPanel as any).gfmAbsPct = gfmAbsPct;
      } else {
        (vm as any).metricsPanel = (vm as any).metricsPanel || {};
        (vm as any).metricsPanel.str = { shifts: flips, swaps: flips, gfmAbsPct };
      }
    } catch {}

    return NextResponse.json({ ok: true, vm }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
