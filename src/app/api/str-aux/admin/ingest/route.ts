import { NextResponse } from "next/server";
import { ingest } from "@/lab/legacy/server/auxStore";
import type { BucketKey } from "@/lab/legacy";

export async function POST(req: Request) {
  try {
    const raw = await req.json();

    // normalize params (tolerant)
    const base = String(raw?.pair?.base || raw?.base || "BTC").toUpperCase();
    const quote = String(raw?.pair?.quote || raw?.quote || "USDT").toUpperCase();
    const win: BucketKey = (raw?.window === "1h" || raw?.window === "3h" || raw?.window === "30m")
      ? raw.window
      : "30m";

    const ack = ingest({
      appSessionId: String(raw?.appSessionId || raw?.session || "default"),
      pair: { base, quote },
      window: win,
      opening: raw?.opening,        // may be partial; healed inside
      latestTs: Number(raw?.latestTs),
      points: Array.isArray(raw?.points) ? raw.points : [],
      metrics: raw?.metrics,
    });

    return NextResponse.json(ack);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
