// src/app/api/pipeline/run-once/route.ts
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { buildAndPersistOnce } from "@/core/pipeline";
import { resolveCoins } from "@/lib/coins/resolve";

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    // 🔑 resolve from settings unless ?coins= provided
    const coins = await resolveCoins(url, { spotOnly: true });
    const out = await buildAndPersistOnce({ coins });
    return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    console.error("[api] pipeline/run-once error", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const coins = await resolveCoins(url, { spotOnly: true });
    const out = await buildAndPersistOnce({ coins });
    return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    console.error("[api] pipeline/run-once GET error", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}