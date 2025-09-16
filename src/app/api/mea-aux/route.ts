// app/api/mea-aux/route.ts
import { NextRequest, NextResponse } from "next/server";
import { buildMeaAux } from "@/auxiliary/mea_aux/buildMeaAux";
import type { IdPctGrid } from "@/auxiliary/mea_aux/buildMeaAux";
import { getAccountBalances } from "../../../sources/binanceAccount";
import { getPool } from "@/db/pool";

export const dynamic = "force-dynamic";

// --- utils ---
function parseCoins(qs: URLSearchParams): string[] | null {
  const raw = qs.get("coins");
  if (!raw) return null;
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}
function coinsKey(arr: string[]) { return arr.join(","); }

const RATE_WINDOW_MS_DEFAULT = Number(process.env.MEA_RATE_WINDOW_MS ?? 10_000); // 10s
const RATE_MAX_DEFAULT       = Number(process.env.MEA_RATE_MAX ?? 4);           // 4 hits/window
const TTL_MS_DEFAULT         = Number(process.env.MEA_CACHE_TTL_MS ?? 40_000);  // 40s

const rateHits = new Map<string, number[]>(); // ip -> timestamps
const cache = {
  idp: new Map<string, { at: number; data: IdPctGrid }>(),           // key: coinsKey
  wal: new Map<string, { at: number; data: Record<string, number> }>()// key: coinsKey
};
const inflight = {
  idp: new Map<string, Promise<IdPctGrid>>(),
  wal: new Map<string, Promise<Record<string, number>>>(),
};

function rateKey(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  return ip;
}

async function fetchLatestIdPct(pool: ReturnType<typeof getPool>, coins: string[]): Promise<IdPctGrid> {
  const tsRes = await pool.query(
    `SELECT MAX(ts_ms) AS ts FROM dyn_matrix_values WHERE matrix_type='id_pct'`
  );
  const latest = Number(tsRes.rows?.[0]?.ts ?? 0);
  const out: IdPctGrid = {};
  for (const c of coins) out[c] = {};
  if (!latest) return out;

  const rows = await pool.query(
    `SELECT base, quote, value
     FROM dyn_matrix_values
     WHERE matrix_type='id_pct' AND ts_ms=$1`,
    [latest]
  );
  for (const r of rows.rows) {
    const b = r.base as string, q = r.quote as string, v = Number(r.value);
    if (!out[b]) out[b] = {};
    out[b][q] = Number.isFinite(v) ? v : null;
  }
  return out;
}

// --- handler ---
export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams;

  // settings-driven inputs
  const coins = parseCoins(qs) ?? (process.env.COINS ?? "BTC,ETH,USDT")
    .split(",").map(s => s.trim()).filter(Boolean);
  const kParam = Number(qs.get("k") ?? NaN);
  const targetK = Number.isFinite(kParam) && kParam > 0 ? Math.floor(kParam) : undefined;

  // timing/limits overrides (all optional)
  const overrideTTL = Number(qs.get("ttlMs") ?? NaN);
  const overrideRateWin = Number(qs.get("rateWindowMs") ?? NaN);
  const overrideRateMax = Number(qs.get("rateMax") ?? NaN);
  const loopMs = Number(qs.get("loopMs") ?? NaN) || undefined;
  const sessionStamp = qs.get("sessionStamp") || undefined;

  const TTL_MS = Number.isFinite(overrideTTL) ? overrideTTL : TTL_MS_DEFAULT;
  const RATE_WINDOW_MS = Number.isFinite(overrideRateWin) ? overrideRateWin : RATE_WINDOW_MS_DEFAULT;
  const RATE_MAX       = Number.isFinite(overrideRateMax) ? overrideRateMax : RATE_MAX_DEFAULT;

  // lightweight per-request rate check
  const now = Date.now();
  const ipKey = rateKey(req);
  const hits = (rateHits.get(ipKey) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  hits.push(now);
  rateHits.set(ipKey, hits);
  const isLimited = RATE_MAX > 0 && RATE_WINDOW_MS > 0 && hits.length > RATE_MAX;

  const warn: string[] = [];
  const pool = getPool();

  // -------- id_pct with cache + de-dupe --------
  const keyCoins = coinsKey(coins);
  let idPct: IdPctGrid = {};
  try {
    const ent = cache.idp.get(keyCoins);
    if (ent && now - ent.at < TTL_MS) {
      idPct = ent.data;
    } else {
      let p = inflight.idp.get(keyCoins);
      if (!p) {
        if (isLimited) {
          return NextResponse.json(
            { ok: false, error: "rate_limited: try again shortly (warming cache)" },
            { status: 429, headers: { "Retry-After": String(Math.ceil(RATE_WINDOW_MS / 1000)) } }
          );
        }
        p = (async () => {
          const res = await fetchLatestIdPct(pool, coins);
          cache.idp.set(keyCoins, { at: Date.now(), data: res });
          return res;
        })();
        inflight.idp.set(keyCoins, p);
      }
      idPct = await p;
      inflight.idp.delete(keyCoins);
    }
  } catch (e: any) {
    warn.push(`id_pct load failed: ${e?.message ?? e}`);
  }

  // -------- wallet with cache + de-dupe --------
  let balances: Record<string, number> = {};
  try {
    const ent = cache.wal.get(keyCoins);
    if (ent && now - ent.at < TTL_MS) {
      balances = ent.data;
    } else {
      let p = inflight.wal.get(keyCoins);
      if (!p) {
        if (isLimited) {
          return NextResponse.json(
            { ok: false, error: "rate_limited: try again shortly (wallet)" },
            { status: 429, headers: { "Retry-After": String(Math.ceil(RATE_WINDOW_MS / 1000)) } }
          );
        }
        p = (async () => {
          const raw = await getAccountBalances(); // live hit
          const data = Object.fromEntries(coins.map(c => [c, Number(raw[c] ?? 0)]));
          cache.wal.set(keyCoins, { at: Date.now(), data });
          return data;
        })();
        inflight.wal.set(keyCoins, p);
      }
      balances = await p;
      inflight.wal.delete(keyCoins);
    }
    if (Object.values(balances).every(v => v === 0)) {
      warn.push("Wallet fetch ok, but zero balances for the selected coins.");
    }
  } catch (e: any) {
    warn.push(`wallet fetch failed: ${e?.message ?? e}`);
  }

  // -------- build output grid --------
  const grid = buildMeaAux({ coins, idPct, balances, k: targetK });

  const payload = {
    ok: true,
    coins,
    k: targetK ?? (coins.length - 1),
    grid,
    meta: {
      warnings: warn,
      loopMs,
      sessionStamp,
      ttlMs: TTL_MS,
      rateWindowMs: RATE_WINDOW_MS,
      rateMax: RATE_MAX
    }
  };

  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
