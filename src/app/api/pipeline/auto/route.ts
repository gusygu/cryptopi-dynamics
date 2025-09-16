// src/app/api/pipeline/auto/route.ts
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import {
  startAutoRefresh,
  stopAutoRefresh,
  getAutoRefreshState,
  isAutoRefreshRunning,
  buildAndPersistOnce,
} from "@/core/pipeline";

/* ------------- helpers ------------- */

function parseCoins(qs: URLSearchParams): string[] | null {
  const raw = qs.get("coins");
  if (!raw) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw.split(",")) {
    const u = String(t || "").trim().toUpperCase();
    if (u && !seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out.length ? out : null;
}
function envCoins(): string[] | null {
  const env = process.env.NEXT_PUBLIC_COINS;
  if (!env) return null;
  const out = Array.from(new Set(
    env.split(",").map(s => s.trim().toUpperCase()).filter(Boolean)
  ));
  return out.length ? out : null;
}
function defaultCoins(): string[] {
  return ["BTC","ETH","BNB","SOL","ADA","XRP","PEPE","USDT"];
}
const parseBool = (qs: URLSearchParams, k: string) =>
  ["1","true","on","yes"].includes((qs.get(k) || "").toLowerCase());

/* ------------- HTTP verbs ------------- */

// Status
export async function GET() {
  const state = getAutoRefreshState();
  return NextResponse.json({ ok: true, running: isAutoRefreshRunning(), state }, { headers: { "Cache-Control": "no-store" } });
}

// Start (optional coins, intervalMs, immediate)
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const qs = url.searchParams;

    const coins = parseCoins(qs) ?? envCoins() ?? defaultCoins();
    const intervalMs = Number(qs.get("intervalMs") ?? NaN);
    const immediate = parseBool(qs, "immediate");

    const started = await startAutoRefresh({
      coins,
      intervalMs: Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : undefined,
      immediate,
    });

    const state = getAutoRefreshState();
    // if the loop was already running and caller asked immediate, run one-shot now
    if (!started && immediate) await buildAndPersistOnce({ coins });

    return NextResponse.json({ ok: true, started, running: isAutoRefreshRunning(), state }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

// Stop
export async function DELETE() {
  stopAutoRefresh();
  const state = getAutoRefreshState();
  return NextResponse.json({ ok: true, running: false, state });
}
