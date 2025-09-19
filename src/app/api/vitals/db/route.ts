import { NextResponse } from "next/server";
import { getDbVitals } from "@/lib/vitals";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const db = await getDbVitals();
  const status = db.ok ? 200 : 500;
  return NextResponse.json(db, { status, headers: { "Cache-Control": "no-store" } });
}