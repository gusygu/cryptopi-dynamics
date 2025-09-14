import { NextResponse } from "next/server";
// legacy auxStore removed; stub
type BucketKey = "30m"|"1h"|"3h";

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
      return NextResponse.json({ ok: false, error: "auxStore debug not available" }, { status: 501 });
    }

    return NextResponse.json({ ok: false, error: "auxStore current not available" }, { status: 501 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
