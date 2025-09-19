// src/app/api/pipeline/auto/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import {
  startAutoRefresh,
  stopAutoRefresh,
  getAutoRefreshState,
  isAutoRefreshRunning,
  buildAndPersistOnce,
} from "@/core/pipeline";
import { getPollerSnapshot } from "@/lib/poller/server";

const parseBool = (v: unknown): boolean =>
  !!String(v ?? "").match(/^(1|true|yes|on)$/i);

function parseCoins(qs: URLSearchParams, bodyCoins?: unknown): string[] | null {
  const fromBody =
    Array.isArray(bodyCoins) && bodyCoins.length
      ? (bodyCoins as unknown[]).map((s) => String(s ?? "").toUpperCase())
      : null;
  const raw = qs.get("coins");
  const seen = new Set<string>();
  const out: string[] = [];

  if (fromBody) for (const t of fromBody) {
    const u = String(t || "").trim().toUpperCase();
    if (u && !seen.has(u)) { seen.add(u); out.push(u); }
  }
  if (raw) for (const t of raw.split(",")) {
    const u = String(t || "").trim().toUpperCase();
    if (u && !seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out.length ? out : null;
}

export async function GET() {
  const state = getAutoRefreshState();
  const snap = await getPollerSnapshot();
  return NextResponse.json(
    { ok: true, running: isAutoRefreshRunning(), state: { ...state, intervalMs: snap.baseMs } },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qs = url.searchParams;
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    const coins = parseCoins(qs, body?.coins) ?? undefined;
    const immediate = parseBool(body?.immediate ?? qs.get("immediate"));

    const started = await startAutoRefresh({ coins, immediate });
    if (!started && immediate) {
      await buildAndPersistOnce({ coins: coins ?? getAutoRefreshState().coins });
    }

    const state = getAutoRefreshState();
    const snap = await getPollerSnapshot();
    return NextResponse.json(
      { ok: true, started, running: isAutoRefreshRunning(), state: { ...state, intervalMs: snap.baseMs } },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function DELETE() {
  stopAutoRefresh();
  const state = getAutoRefreshState();
  const snap = await getPollerSnapshot();
  return NextResponse.json(
    { ok: true, running: false, state: { ...state, intervalMs: snap.baseMs } },
    { headers: { "Cache-Control": "no-store" } }
  );
}
