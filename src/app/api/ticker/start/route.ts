import { NextRequest, NextResponse } from "next/server";
// Legacy ticker sampler removed; return a 501-like no-op with ok=false

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await req.json().catch(() => ({}));
    return NextResponse.json({ ok: false, error: "ticker sampler not available" }, { status: 501 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "error" }, { status: 500 });
  }
}
