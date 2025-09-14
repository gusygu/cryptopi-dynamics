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

async function opt<T = any>(p: string): Promise<T | null> {
  try { return (await import(/* @vite-ignore */ p)) as T; } catch { return null; }
}

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
  const keyCoins = coins.join(",");

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
          } catch { /* ignore DB path */ }

          // 2) fallback: call /api/matrices/latest if DB path had no data
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
            } catch { /* ignore fetch path */ }
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

  // -------- build MEA grid --------
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
  const tiers = await opt<any>("@/auxiliary/mea_aux/tiers");
  
  // Optional tier for a specific Ca/Cb
  const Ca = (qs.get("Ca") || "").toUpperCase();
  const Cb = (qs.get("Cb") || "").toUpperCase();
  let tierLabel: string | undefined;
  if (Ca && Cb && Array.isArray((grid as any)?.weights)) {
    const idx = Object.fromEntries(coins.map((c, i) => [c, i]));
    const i = idx[Ca], j = idx[Cb];
    const w = Number((grid as any).weights?.[i]?.[j]);
    if (Number.isFinite(w)) {
      tierLabel = typeof tiers?.getTier === "function"
        ? tiers.getTier(w)
        : (w >= 1.10 ? "α-tier" : w >= 1.02 ? "β-tier" : w > 0.99 ? "γ-tier" : "δ-tier");
    }
  }

  return NextResponse.json(
    { ok: true, coins, k: kEff, grid, ...(tierLabel ? { tierLabel } : {}) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
