import { NextRequest, NextResponse } from "next/server";
// use relative import to avoid alias issues
import { db } from "@/lib/str-aux/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const base = searchParams.get("base") ?? "BTC";
  const quote = searchParams.get("quote") ?? "USDT";
  const window = (searchParams.get("window") ?? "30m") as "30m" | "1h" | "3h";
  const appSessionId = searchParams.get("session") ?? "dev-session";
  try {
    const latest = await db.getLatest({ base, quote, window, appSessionId });
    if (!latest) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, doc: latest });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "error" }, { status: 500 });
  }
}
