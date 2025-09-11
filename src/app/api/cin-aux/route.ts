import { NextRequest, NextResponse } from "next/server";
import { getAll as getSettings } from "@/lib/settings/server";
import { db } from "@/core/db";
import { fetch24hAll } from "@/sources/binance";
import { getAccountBalances } from "@/sources/binanceAccount";

export const dynamic = "force-dynamic";

type UiRow = {
  symbol: string;
  wallet_usdt: number;
  profit_usdt: number;       // reserved for PnL (0 for now)
  session_imprint: number;   // imprint (session)
  session_luggage: number;   // luggage (session)
  cycle_imprint: number;     // imprint (cycle)
  cycle_luggage: number;     // luggage (cycle)
};

const APP_SESSION = process.env.NEXT_PUBLIC_APP_SESSION_ID || "dev-session";
const norm = (s: string) => String(s || "").trim().toUpperCase();
const uniq = (a: string[]) => Array.from(new Set(a.filter(Boolean)));

function coinsFrom(q: URLSearchParams, settingsCoins: string[]) {
  const qCoins = (q.get("coins") || "")
    .split(/[,\s]+/)
    .map(norm)
    .filter(Boolean);
  return (qCoins.length ? qCoins : uniq(settingsCoins.map(norm)));
}

async function latestCycleTs(appSessionId: string): Promise<number | null> {
  const r = await db.query<{ ts: string }>(
    `select max(cycle_ts)::text as ts
       from cin_aux_cycle
      where app_session_id = $1`,
    [appSessionId]
  );
  const n = Number(r.rows?.[0]?.ts || 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function readCinView(appSessionId: string, cycleTs: number, coins: string[]) {
  // filter by base symbol prefix (BTC*, ETH*, …)
  const rx = coins.length ? `^(${coins.join("|")})` : null;
  const args: any[] = [appSessionId, cycleTs];
  const sql = rx
    ? `select symbol,
              imprint_cycle_usdt,  luggage_cycle_usdt,
              imprint_app_session_usdt, luggage_app_session_usdt
         from v_cin_aux
        where app_session_id=$1 and cycle_ts=$2 and symbol ~ $3
        order by symbol`
    : `select symbol,
              imprint_cycle_usdt,  luggage_cycle_usdt,
              imprint_app_session_usdt, luggage_app_session_usdt
         from v_cin_aux
        where app_session_id=$1 and cycle_ts=$2
        order by symbol`;
  if (rx) args.push(rx);
  const r = await db.query(sql, args);
  const bySym = new Map<string, any>();
  for (const row of r.rows) bySym.set(String(row.symbol).toUpperCase(), row);
  return bySym;
}

async function usdtPrices(bases: string[]): Promise<Record<string, number>> {
  const coins = uniq(bases.map(norm)).filter((c) => c && c !== "USDT");
  if (!coins.length) return { USDT: 1 };
  const symbols = coins.map((c) => `${c}USDT`);
  const tickers = await fetch24hAll(symbols);
  const out: Record<string, number> = { USDT: 1 };
  for (const t of tickers ?? []) {
    const sym = String(t?.symbol ?? "");
    const base = sym.replace(/USDT$/i, "");
    const p = Number((t as any)?.lastPrice ?? (t as any)?.weightedAvgPrice ?? NaN);
    if (base && Number.isFinite(p)) out[base] = p;
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.searchParams;
    const settings = await getSettings();
    const coins = coinsFrom(qs, settings.coinUniverse ?? []);
    const appSessionId = (qs.get("appSessionId") || APP_SESSION).slice(0, 64);

    // find latest cycle; keep rendering even if null (wallet-only rows)
    const ts = await latestCycleTs(appSessionId);

    // base data
    const [wallet, prices, cinBySym] = await Promise.all([
      getAccountBalances(),                 // { BTC: 0.12, ETH: 3.4, ... }
      usdtPrices(coins),                    // { BTC: 67k, ETH: 3.4k, USDT: 1 }
      ts ? readCinView(appSessionId, ts, coins) : Promise.resolve(new Map<string, any>()),
    ]);

    const rows: UiRow[] = coins.map((sym) => {
      const qty = Number((wallet as any)?.[sym] ?? 0);
      const px = Number(prices?.[sym] ?? (sym === "USDT" ? 1 : 0));
      const wallet_usdt = Number.isFinite(qty * px) ? qty * px : 0;

      const cin = cinBySym.get(sym);
      return {
        symbol: sym,
        wallet_usdt,
        profit_usdt: 0,
        session_imprint: Number(cin?.imprint_app_session_usdt ?? 0),
        session_luggage: Number(cin?.luggage_app_session_usdt ?? 0),
        cycle_imprint: Number(cin?.imprint_cycle_usdt ?? 0),
        cycle_luggage: Number(cin?.luggage_cycle_usdt ?? 0),
      };
    });

    return NextResponse.json(
      { ok: true, coins, rows, cycleTs: ts, ts: Date.now() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
