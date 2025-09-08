import { NextRequest, NextResponse } from "next/server";
import { buildMeaAux } from "@/auxiliary/mea_aux/buildMeaAux";
import type { IdPctGrid } from "@/auxiliary/mea_aux/buildMeaAux";
import { getAccountBalances } from "../../../sources/binanceAccount";
import { getPool } from "@/db/pool";

export const dynamic = "force-dynamic";

function parseCoins(qs: URLSearchParams): string[] | null {
  const raw = qs.get("coins");
  if (!raw) return null;
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

// Basic in-memory rate limiting to prevent accidental floods from a single client.
const RATE_WINDOW_MS = Number(process.env.MEA_RATE_WINDOW_MS ?? 10_000); // 10s window
const RATE_MAX = Number(process.env.MEA_RATE_MAX ?? 4);                  // max 4 hits / window
const rateHits = new Map<string, number[]>();

function rateKey(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  return ip;
}

function isRateLimited(req: NextRequest) {
  if (RATE_MAX <= 0 || RATE_WINDOW_MS <= 0) return false;
  const key = rateKey(req);
  const now = Date.now();
  const arr = (rateHits.get(key) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  arr.push(now);
  rateHits.set(key, arr);
  return arr.length > RATE_MAX;
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

/**
 * API-level cache/throttle
 * - ttl 40s to align with cycles
 * - keys by (coins) for both wallet and id_pct
 * - de-dupe so concurrent requests share the same in-flight promise
 */
type CacheEntry<T> = { at: number; data: T };
type InFlight<T> = Promise<T> | null;

const TTL_MS = Number(process.env.MEA_CACHE_TTL_MS ?? 40_000);

const cache = {
  idp: new Map<string, CacheEntry<IdPctGrid>>(),                  // key: coinsKey
  wal: new Map<string, CacheEntry<Record<string, number>>>(),     // key: coinsKey
};
const inflight = {
  idp: new Map<string, InFlight<IdPctGrid>>(),
  wal: new Map<string, InFlight<Record<string, number>>>(),
};

function coinsKey(arr: string[]) { return arr.join(","); }

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams;
  const coins = parseCoins(qs) ?? (process.env.COINS ?? "BTC,ETH,USDT")
    .split(",").map(s => s.trim()).filter(Boolean);

  const k = Number(qs.get("k") ?? NaN);
  const targetK = Number.isFinite(k) && k > 0 ? Math.floor(k) : undefined;

  const warn: string[] = [];
  const pool = getPool();
  const limited = isRateLimited(req);

  // -------- id_pct with cache + de-dupe --------
  const keyCoins = coinsKey(coins);
  let idPct: IdPctGrid = {};
  try {
    const ent = cache.idp.get(keyCoins);
    const now = Date.now();
    if (ent && now - ent.at < TTL_MS) {
      idPct = ent.data;
    } else {
      let p = inflight.idp.get(keyCoins);
      if (!p) {
        if (limited) {
          // Too many calls and no fresh cache: refuse creating new work
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
  const keyWal = keyCoins;
  let balances: Record<string, number> = {};
  try {
    const ent = cache.wal.get(keyWal);
    const now = Date.now();
    if (ent && now - ent.at < TTL_MS) {
      balances = ent.data;
    } else {
      let p = inflight.wal.get(keyWal);
      if (!p) {
        if (limited) {
          return NextResponse.json(
            { ok: false, error: "rate_limited: try again shortly (wallet)" },
            { status: 429, headers: { "Retry-After": String(Math.ceil(RATE_WINDOW_MS / 1000)) } }
          );
        }
        p = (async () => {
          let data: Record<string, number>;
          const raw = await getAccountBalances(); // live hit
          data = Object.fromEntries(coins.map(c => [c, Number(raw[c] ?? 0)]));
          cache.wal.set(keyWal, { at: Date.now(), data });
          return data;
        })();
        inflight.wal.set(keyWal, p);
      }
      balances = await p;
      inflight.wal.delete(keyWal);
    }
    if (Object.values(balances).every(v => v === 0)) {
      warn.push("Wallet fetch ok, but zero balances for the selected coins.");
    }
  } catch (e: any) {
    warn.push(`wallet fetch failed: ${e?.message ?? e}`);
  }

  // -------- build matrix --------
  const grid = buildMeaAux({ coins, idPct, balances, k: targetK });

  return NextResponse.json(
    { ok: true, coins, k: targetK ?? (coins.length - 1), grid, meta: { warnings: warn } },
    { headers: { "Cache-Control": "no-store" } }
  );
}
