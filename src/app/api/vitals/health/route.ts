import { NextRequest, NextResponse } from "next/server";
import { getExchangeVitals } from "@/lib/vitals";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const coin = params.get("coin") ?? undefined;
    const depth = params.get("depth");
    const includeAll = params.get("all") === "1";
    const body = await getExchangeVitals({
      coin,
      depth: depth ? Number(depth) : undefined,
      includeAll,
    });
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}