import { NextResponse } from "next/server";
import { getCurrent, getDebug } from "@/lab/legacy/server/auxStore";
import type { BucketKey } from "@/lab/legacy";

export async function GET(req: Request) {
  try {
    const { searchParams, pathname } = new URL(req.url);
    const base  = String(searchParams.get("base")  || "BTC").toUpperCase();
    const quote = String(searchParams.get("quote") || "USDT").toUpperCase();
    const appSessionId = String(searchParams.get("appSessionId") || "default");
    const winParam = String(searchParams.get("win") || "30m");
    const win: BucketKey = (winParam === "1h" || winParam === "3h" || winParam === "30m") ? (winParam as BucketKey) : "30m";

    // optional: crude debug passthrough if someone calls `/api/auxi/current?debug=1`
    if (searchParams.get("debug")) {
      return NextResponse.json(getDebug());
    }

    const out = getCurrent(appSessionId, base, quote, win);
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
