// src/app/(server)/wire-converter.ts
// SERVER-ONLY boot wiring for the Converter providers

import { wireConverterSources } from "@/converters/Converter.server";
import { makeMatricesHttpProvider } from "@/converters/providers/matrices.http"; // ← NEW: HTTP provider
import { makeMeaModuleProvider } from "@/converters/providers/meaaux.module";
import { makeStrDbProvider } from "@/converters/providers/straux.db";
import { makeCinDbProvider } from "@/converters/providers/cinaux.db";
import { makeWalletHttpProvider } from "@/converters/providers/wallet.http";

// ────────────────────────────────────────────────────────────────────────────────
const APP_SESSION = process.env.NEXT_PUBLIC_APP_SESSION_ID || "dev-session";
const STR_WINDOW: "30m" | "1h" | "3h" =
  (process.env.NEXT_PUBLIC_STR_WINDOW as any) || "30m";

// ── mea-aux (module) ────────────────────────────────────────────────────────────
import { getTierWeighting } from "@/auxiliary/mea_aux/tiers";
import { getLatestTsForType, getSnapshotByType } from "@/core/db";

async function mea_getMeaForPair(pair: { base: string; quote: string }) {
  const coins = (process.env.COINS ?? "BTC,ETH,BNB,SOL,ADA,USDT")
    .split(",")
    .map((s) => s.trim().toUpperCase());

  const ts = await getLatestTsForType("id_pct");
  let idp = 0;
  if (ts) {
    const rows = await getSnapshotByType("id_pct", ts, coins);
    const hit = rows.find((r: any) => r.base === pair.base && r.quote === pair.quote);
    idp = Number(hit?.value ?? 0);
  }
  const fraction = Math.abs(idp) > 1.5 ? idp / 100 : idp;
  const weight = getTierWeighting(fraction);
  const tier =
    weight >= 1.1 ? "α-tier" :
    weight >= 1.02 ? "β-tier" :
    weight > 0.99 ? "γ-tier" : "δ-tier";
  return { value: weight, tier };
}

const meaProvider = makeMeaModuleProvider({ getMeaForPair: mea_getMeaForPair }) as any;
// (optional) attach grid if/when you have a canonical builder:
// meaProvider.getMeaGrid = (...args) => /* buildMeaAux(...) */;

// ── str-aux (db) ────────────────────────────────────────────────────────────────
import { db as strAuxDb } from "@/lib/str-aux/db";
import { db } from "@/core/db";

async function str_getIdPctHistory(from: string, to: string, lastN = 6) {
  const q = `
    select value
      from dyn_matrix_values
     where matrix_type='id_pct' and base=$1 and quote=$2
     order by ts_ms desc
     limit $3`;
  const r = await db.query<{ value: string | number }>(q, [from, to, lastN]);
  return r.rows.map((x: { value: string | number }) => Number(x.value ?? 0));
}

async function str_getIdPctHistoryTs(from: string, to: string, lastN = 8) {
  const q = `
    select ts_ms, value
      from dyn_matrix_values
     where matrix_type='id_pct' and base=$1 and quote=$2
     order by ts_ms desc
     limit $3`;
  const r = await db.query<{ ts_ms: string | number; value: string | number }>(q, [from, to, lastN]);
  return r.rows.map((x: { ts_ms: string | number; value: string | number }) => ({
    ts_ms: Number(x.ts_ms),
    value: Number(x.value ?? 0),
  }));
}

// Optional: pct derivative history (prefer materialized pct_drv; else derive from id_pct)
async function str_getPctDrvHistory(from: string, to: string, lastN = 6) {
  const q = `
    select value
      from dyn_matrix_values
     where matrix_type='pct_drv' and base=$1 and quote=$2
     order by ts_ms desc
     limit $3`;
  const r1 = await db
    .query<{ value: string | number }>(q, [from, to, lastN])
    .catch(() => ({ rows: [] as Array<{ value: string | number }> }));
  if (r1.rows.length) {
    return r1.rows.map((x: { value: string | number }) => Number(x.value ?? 0));
  }
  const idHist = await str_getIdPctHistory(from, to, Math.max(lastN + 1, 6));
  const drv: number[] = [];
  for (let i = 1; i < idHist.length; i++) drv.push((idHist[i] ?? 0) - (idHist[i - 1] ?? 0));
  return drv.slice(-lastN);
}

async function str_getPctDrvHistoryTs(from: string, to: string, lastN = 8) {
  const q = `
    select ts_ms, value
      from dyn_matrix_values
     where matrix_type='pct_drv' and base=$1 and quote=$2
     order by ts_ms desc
     limit $3`;
  const r1 = await db
    .query<{ ts_ms: string | number; value: string | number }>(q, [from, to, lastN])
    .catch(() => ({ rows: [] as Array<{ ts_ms: string | number; value: string | number }> }));
  if (r1.rows.length) {
    return r1.rows.map((x: { ts_ms: string | number; value: string | number }) => ({
      ts_ms: Number(x.ts_ms),
      value: Number(x.value ?? 0),
    }));
  }
  const idRows = await str_getIdPctHistoryTs(from, to, Math.max(lastN + 1, 8));
  const drv: Array<{ ts_ms: number; value: number }> = [];
  for (let i = 1; i < idRows.length; i++) {
    drv.push({
      ts_ms: idRows[i].ts_ms,
      value: idRows[i].value - idRows[i - 1].value,
    });
  }
  return drv.slice(-lastN);
}

async function str_getGfm() {
  const doc = await strAuxDb.getLatest({ base: "BTC", quote: "USDT", window: STR_WINDOW, appSessionId: APP_SESSION });
  return Number((doc as any)?.stats?.gfm ?? 0);
}

async function str_getShift() {
  const doc = await strAuxDb.getLatest({ base: "BTC", quote: "USDT", window: STR_WINDOW, appSessionId: APP_SESSION });
  return Number((doc as any)?.stats?.deltaGfm ?? 0);
}

async function str_getVTendency(pair: { base: string; quote: string }) {
  const doc = await strAuxDb.getLatest({ base: pair.base, quote: pair.quote, window: STR_WINDOW, appSessionId: APP_SESSION });
  const s = (doc as any)?.stats;
  const v = Number((s?.vOuter ?? 0) - (s?.vInner ?? 0));
  return Number.isFinite(v) ? v : 0;
}

async function str_getStats(pair: { base: string; quote: string }) {
  const doc = await strAuxDb.getLatest({
    base: pair.base,
    quote: pair.quote,
    window: STR_WINDOW,
    appSessionId: APP_SESSION,
  });
  const s = (doc as any)?.stats ?? {};
  return {
    gfm: Number(s.gfm ?? 0),
    shift: Number(s.deltaGfm ?? 0),
    vOuter: Number(s.vOuter ?? 0),
  };
}

// ── cin-aux (db) ────────────────────────────────────────────────────────────────
async function cin_getLatestCycleTs(appSessionId: string) {
  const r = await db.query<{ ts: string }>(
    `select max(cycle_ts)::text as ts from cin_aux_cycle where app_session_id=$1`,
    [appSessionId]
  );
  const ts = Number(r.rows[0]?.ts || 0);
  return Number.isFinite(ts) && ts > 0 ? ts : null;
}

async function cin_getWallet(symbol: string, appSessionId = APP_SESSION) {
  const ts = await cin_getLatestCycleTs(appSessionId);
  if (!ts) return 0;
  const r = await db.query<{ qty: string }>(
    `select qty from wallet_snapshots where app_session_id=$1 and cycle_ts=$2 and symbol=$3`,
    [appSessionId, ts, symbol]
  );
  const v = Number(r.rows[0]?.qty || 0);
  return Number.isFinite(v) ? v : 0;
}

async function cin_getCinStats(
  symbols: string[],
  appSessionId = APP_SESSION
): Promise<
  Array<{
    symbol: string;
    session_imprint: number;
    session_luggage: number;
    cycle_imprint: number;
    cycle_luggage: number;
  }>
> {
  const ts = await cin_getLatestCycleTs(appSessionId);
  if (!ts) return [];
  type CinRow = {
    symbol: string;
    imprint_cycle_usdt: number | string | null;
    luggage_cycle_usdt: number | string | null;
    imprint_app_session_usdt: number | string | null;
    luggage_app_session_usdt: number | string | null;
  };
  const r = await db.query<CinRow>(
    `select symbol,
            imprint_cycle_usdt,
            luggage_cycle_usdt,
            imprint_app_session_usdt,
            luggage_app_session_usdt
       from v_cin_aux
      where app_session_id=$1 and cycle_ts=$2 and symbol = any($3)
      order by symbol`,
    [appSessionId, ts, symbols]
  );
  return r.rows.map((row: CinRow) => ({
    symbol: row.symbol,
    session_imprint: Number(row.imprint_app_session_usdt ?? 0),
    session_luggage: Number(row.luggage_app_session_usdt ?? 0),
    cycle_imprint: Number(row.imprint_cycle_usdt ?? 0),
    cycle_luggage: Number(row.luggage_cycle_usdt ?? 0),
  }));
}

// ── wire everything ─────────────────────────────────────────────────────────────
// 1) STR provider: pass only known deps, then attach optional method to instance
const strDeps = {
  getIdPctHistory: str_getIdPctHistory,
  getGfm:          str_getGfm,
  getShift:        str_getShift,
  getVTendency:    ({ base, quote }: { base: string; quote: string }) => str_getVTendency({ base, quote }),
};
const strProvider = makeStrDbProvider(strDeps) as any;
strProvider.getPctDrvHistory   = str_getPctDrvHistory;     // existing numeric helper (if you kept it)
strProvider.getPctDrvHistoryTs = str_getPctDrvHistoryTs;   // timestamped
strProvider.getIdPctHistoryTs  = str_getIdPctHistoryTs;    // timestamped
strProvider.getStats           = str_getStats;

// 2) Wire all providers into the Converter
wireConverterSources({
  // Matrices now come from the HTTP endpoint keyed by the Settings universe
  matrices: makeMatricesHttpProvider(process.env.NEXT_PUBLIC_BASE_URL ?? ""),
  mea:      meaProvider,
  str:      strProvider,
  cin:      makeCinDbProvider({
              getWallet:   (s) => cin_getWallet(s),
              getCinStats: (syms) => cin_getCinStats(syms),
            }),
  wallet:   makeWalletHttpProvider(),
});
