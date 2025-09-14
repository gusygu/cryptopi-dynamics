import { NextResponse } from "next/server";
// legacy auxStore removed; return not implemented for now
type BucketKey = "30m"|"1h"|"3h";

export async function POST(req: Request) {
  try {
    const raw = await req.json();

    // normalize params (tolerant)
    const base = String(raw?.pair?.base || raw?.base || "BTC").toUpperCase();
    const quote = String(raw?.pair?.quote || raw?.quote || "USDT").toUpperCase();
    const win: BucketKey = (raw?.window === "1h" || raw?.window === "3h" || raw?.window === "30m")
      ? raw.window
      : "30m";

    return NextResponse.json({ ok: false, error: "auxStore ingest not available" }, { status: 501 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
