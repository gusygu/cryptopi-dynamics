import { NextResponse } from "next/server";
import { getDbVitals, getExchangeVitals, getStatusReport } from "@/lib/vitals";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const [status, exchange, db] = await Promise.all([
      getStatusReport(),
      getExchangeVitals({ includeAll: false }),
      getDbVitals(),
    ]);
    return NextResponse.json({ ok: true, status, exchange, db }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}