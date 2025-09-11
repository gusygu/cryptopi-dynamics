// src/app/api/mea-aux/route.ts
import { NextRequest, NextResponse } from "next/server";
import { buildMeaAux } from "@/auxiliary/mea_aux/buildMeaAux";
import type { IdPctGrid } from "@/auxiliary/mea_aux/buildMeaAux";
import { getAccountBalances } from "@/sources/binanceAccount";
import { getPool } from "@/db/pool";
import { getAll as getSettings } from "@/lib/settings/server";

export const dynamic = "force-dynamic";

/* ------------------------- helpers ------------------------- */

function normCoin(s: string) { return String(s || "").trim().toUpperCase(); }
function parseCoins(qs: URLSearchParams): string[] | null {
  const raw = qs.get("coins");
  if (!raw) return null;
  const seen = new Set<string>(); const out: string[] = [];
  for (const s of raw.split(",")) { const u = normCoin(s); if (!u || seen.has(u)) continue; seen.add(u); out.push(u); }
  return out.length ? out : null;
}
function clampK(k: number | undefined, coinsN: number) {
  const max = Math.max(1, coinsN - 1);
  if (!Number.isFinite(k as number)) return max;
  const v = Math.floor(k as number);
  return Math.min(max, Math.max(1, v));
}
const RATE_WINDOW_MS = Number(process.env.MEA_RATE_WINDOW_MS ?? 10_000);
const RATE_MAX = Number(process.env.MEA_RATE_MAX ?? 4);
const rateHits = new Map<string, number[]>();
function rateKey(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
function isRateLimited(req: NextRequest) {
  if (RATE_MAX <= 0 || RATE_WINDOW_MS <= 0) return false;
  const key = rateKey(req);
  const now = Date.now();
  const arr = (rateHits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  rateHits.set(key, arr);
  return arr.length > RATE_MAX;
}
const coinsKey = (arr: string[]) => arr.join(",");

// quick counter of finite values in id_pct grid
function countFinite(grid: IdPctGrid): number {
  let c = 0;
  for (const b of Object.keys(grid)) {
    const row = grid[b] ?? {};
    for (const q of Object.keys(row)) {
      const v = row[q];
      if (v != null && Number.isFinite(Number(v))) c++;
    }
  }
  return c;
}

/* --------------------- cache / de-dupe layer --------------------- */
type CacheEntry<T> = { at: number; data: T };
type InFlight<T> = Promise<T> | null;
const TTL_MS = Number(process.env.MEA_CACHE_TTL_MS ?? 40_000);
const cache = {
  idp: new Map<string, CacheEntry<IdPctGrid>>(),
  wal: new Map<string, CacheEntry<Record<string, number>>>(),
};
const inflight = {
  idp: new Map<string, InFlight<IdPctGrid>>(),
  wal: new Map<string, InFlight<Record<string, number>>>(),
};

/* ------------------------------- GET ------------------------------- */

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams;

  // coins: prefer query, else Settings.coinUniverse, else env COINS
  const coinsFromQuery = parseCoins(qs);
  const settings = await getSettings();
  const coinsFromSettings = (settings.coinUniverse ?? []).map(normCoin).filter(Boolean);
  const coins =
    coinsFromQuery ??
    (coinsFromSettings.length ? coinsFromSettings
      : (process.env.COINS ?? "BTC,ETH,USDT").split(",").map(normCoin).filter(Boolean));

  if (coins.length < 2) {
    return NextResponse.json({ ok: false, error: "need_at_least_two_coins", coins }, { status: 400 });
  }

  const kParam = Number(qs.get("k") ?? NaN);
  const kEff = clampK(Number.isFinite(kParam) ? kParam : undefined, coins.length);

  const pool = getPool();
  const limited = isRateLimited(req);

  const keyCoins = coinsKey(coins);

  // -------- id_pct (DB → fallback to matrices/latest) --------
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
          return NextResponse.json(
            { ok: false, error: "rate_limited: try again shortly (warming cache)" },
            { status: 429, headers: { "Retry-After": String(Math.ceil(RATE_WINDOW_MS / 1000)) } }
          );
        }
        p = (async () => {
          // 1) try DB: compute from latest two benchmark snapshots
          const out: IdPctGrid = {};
          for (const c of coins) out[c] = {};
          try {
            const tsRes = await pool.query(
              `SELECT DISTINCT ts_ms FROM dyn_matrix_values WHERE matrix_type='benchmark' ORDER BY ts_ms DESC LIMIT 2`
            );
            const stamps: number[] = tsRes.rows.map((r: any) => Number(r.ts_ms ?? r.ts)).filter(Number.isFinite);
            if (stamps.length >= 2) {
              const [latest, previous] = [stamps[0], stamps[1]];
              const rows = await pool.query(
                `SELECT base, quote, value, ts_ms FROM dyn_matrix_values WHERE matrix_type='benchmark' AND ts_ms IN ($1,$2)`,
                [latest, previous]
              );
              const newer = new Map<string, number>();
              const older = new Map<string, number>();
              const key = (b: string, q: string) => `${normCoin(b)}|${normCoin(q)}`;
              for (const r of rows.rows) {
                const k = key(r.base, r.quote);
                const v = Number(r.value);
                if (!Number.isFinite(v)) continue;
                if (Number(r.ts_ms) === latest) newer.set(k, v);
                else older.set(k, v);
              }
              for (const b of coins) for (const q of coins) {
                if (b === q) { out[b][q] = null; continue; }
                const k = `${b}|${q}`, nv = newer.get(k), ov = older.get(k);
                out[b][q] = (nv != null && ov != null && ov !== 0) ? (nv - ov) / ov : null;
              }
            }
          } catch {/* ignore DB path */}

          // 2) fallback: if DB gave nothing, pull from /api/matrices/latest
          if (countFinite(out) === 0) {
            try {
              const origin = req.nextUrl.origin;
              const u = new URL("/api/matrices/latest", origin);
              u.searchParams.set("coins", coins.join(","));
              const r = await fetch(u.toString(), { cache: "no-store" });
              const j = await r.json();
              const m: number[][] | null = j?.matrices?.id_pct ?? null;
              if (Array.isArray(m)) {
                for (let i = 0; i < coins.length; i++) {
                  const b = coins[i];
                  out[b] = out[b] || {};
                  for (let j2 = 0; j2 < coins.length; j2++) {
                    const q = coins[j2];
                    out[b][q] = (i === j2) ? null : (Number.isFinite(m?.[i]?.[j2]) ? Number(m[i][j2]) : null);
                  }
                }
              }
            } catch {/* ignore fetch path */}
          }

          cache.idp.set(keyCoins, { at: Date.now(), data: out });
          return out;
        })();
        inflight.idp.set(keyCoins, p);
      }
      idPct = await p;
      inflight.idp.delete(keyCoins);
    }
  } catch {
    idPct = {};
    for (const c of coins) idPct[c] = {};
  }

  // -------- wallet (cache + de-dupe) --------
  let balances: Record<string, number> = {};
  try {
    const ent = cache.wal.get(keyCoins);
    const now = Date.now();
    if (ent && now - ent.at < TTL_MS) {
      balances = ent.data;
    } else {
      let p = inflight.wal.get(keyCoins);
      if (!p) {
        if (limited) {
          return NextResponse.json(
            { ok: false, error: "rate_limited: try again shortly (wallet)" },
            { status: 429, headers: { "Retry-After": String(Math.ceil(RATE_WINDOW_MS / 1000)) } }
          );
        }
        p = (async () => {
          const raw = await getAccountBalances();
          const data = Object.fromEntries(coins.map((c) => [c, Number(raw[c] ?? 0)]));
          cache.wal.set(keyCoins, { at: Date.now(), data });
          return data;
        })();
        inflight.wal.set(keyCoins, p);
      }
      balances = await p;
      inflight.wal.delete(keyCoins);
    }
  } catch {}

  // -------- build matrix --------
  let grid: ReturnType<typeof buildMeaAux>;
  try {
    grid = buildMeaAux({ coins, idPct, balances, k: kEff });
  } catch (err: any) {
    const safeK = Math.max(1, coins.length - 1);
    if (safeK !== kEff) {
      try {
        grid = buildMeaAux({ coins, idPct, balances, k: safeK });
      } catch (err2: any) {
        return NextResponse.json({ ok: false, error: String(err2?.message ?? err2) }, { status: 500 });
      }
    } else {
      return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
    }
  }

  return NextResponse.json(
    { ok: true, coins, k: kEff, grid, meta: { warnings: [] } },
    { headers: { "Cache-Control": "no-store" } }
  );
}
