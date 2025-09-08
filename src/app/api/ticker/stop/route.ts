import { NextResponse } from "next/server";
import { stopTicker } from "@/lab/legacy/sampler/binanceTicker";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const out = stopTicker();
    const status = out.ok ? 200 : 409;
    return NextResponse.json(out, { status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "error" }, { status: 500 });
  }
}
