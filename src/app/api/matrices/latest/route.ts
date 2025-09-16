import { NextRequest, NextResponse } from "next/server";
import { resolveCoinsFromSettings } from "@/lib/settings/server";
import { buildLatestPayload } from "@/core/matricesLatest";
import type { MatrixType } from "@/core/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

const TYPES: MatrixType[] = ["benchmark", "delta", "pct24h", "id_pct", "pct_drv"];
const DEFAULT_COINS = ["BTC", "ETH", "BNB", "SOL", "ADA", "XRP", "PEPE", "USDT"];

function uniqUpper(list: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const up = String(item || "").trim().toUpperCase();
    if (!up || seen.has(up)) continue;
    seen.add(up);
    out.push(up);
  }
  return out;
}

function parseCoins(params: URLSearchParams, fallback: string[]): string[] {
  const raw = params.get("coins");
  if (!raw) return fallback;
  const parsed = uniqUpper(raw.split(","));
  return parsed.length ? parsed : fallback;
}

function countGridCells(grid: unknown): number {
  if (!Array.isArray(grid)) return 0;
  let n = 0;
  for (const row of grid) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      if (cell != null) n += 1;
    }
  }
  return n;
}

function toRingsMap(
  coins: string[],
  previewGrid: number[][] | undefined | null
): Record<string, Record<string, "direct" | "inverse" | "none">> {
  if (!Array.isArray(previewGrid)) return {};
  const out: Record<string, Record<string, "direct" | "inverse" | "none">> = {};
  const n = coins.length;
  for (let i = 0; i < n; i++) {
    const row: Record<string, "direct" | "inverse" | "none"> = {};
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const val = previewGrid[i]?.[j] ?? 0;
      let label: "direct" | "inverse" | "none" = "none";
      if (val === 1) label = "direct";
      else if (val === 2) label = "inverse";
      row[coins[j]] = label;
    }
    out[coins[i]] = row;
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    let defaults = DEFAULT_COINS;
    try {
      const fromSettings = await resolveCoinsFromSettings();
      defaults = fromSettings.length ? fromSettings : DEFAULT_COINS;
    } catch {
      defaults = DEFAULT_COINS;
    }

    const coins = parseCoins(req.nextUrl.searchParams, defaults);

    let previewSet: Set<string> | undefined;
    try {
      const pvUrl = new URL("/api/preview/binance", req.nextUrl.origin);
      pvUrl.searchParams.set("coins", coins.join(","));
      const pv = await fetch(pvUrl, { cache: "no-store" });
      if (pv.ok) {
        const body = await pv.json().catch(() => null);
        const symbols: string[] = Array.isArray(body?.symbols) ? body.symbols : [];
        if (symbols.length) previewSet = new Set(uniqUpper(symbols));
      }
    } catch {
      previewSet = undefined;
    }

    const payload = await buildLatestPayload({ coins, previewSymbols: previewSet });
    const matrices = (payload.matrices ?? {}) as Partial<Record<MatrixType, (number | null)[][] | null>>;

    const rows: Record<MatrixType, number> = {
      benchmark: countGridCells(matrices.benchmark),
      delta: countGridCells(matrices.delta),
      pct24h: countGridCells(matrices.pct24h),
      id_pct: countGridCells(matrices.id_pct),
      pct_drv: countGridCells(matrices.pct_drv),
    };

    const rings = toRingsMap(coins, (payload.flags as any)?.benchmark?.preview ?? null);

    const body = {
      ...payload,
      benchmark: matrices.benchmark ?? null,
      delta: matrices.delta ?? null,
      pct24h: matrices.pct24h ?? null,
      id_pct: matrices.id_pct ?? null,
      pct_drv: matrices.pct_drv ?? null,
      rows,
      rings,
    };

    const res = NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
    res.headers.set("x-coins-used", coins.join(","));
    for (const t of TYPES) {
      res.headers.set(`x-rows-${t}`, String(rows[t] ?? 0));
    }
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}