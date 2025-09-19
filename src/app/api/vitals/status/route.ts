import { NextResponse } from "next/server";
import { getStatusReport } from "@/lib/vitals";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const report = await getStatusReport();
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}