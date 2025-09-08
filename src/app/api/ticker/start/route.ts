import { NextRequest, NextResponse } from "next/server";
import { startTicker } from "@/lab/legacy/sampler/binanceTicker";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const out = startTicker(body ?? {});
    const status = out.ok ? 200 : 409;
    return NextResponse.json(out, { status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "error" }, { status: 500 });
  }
}
