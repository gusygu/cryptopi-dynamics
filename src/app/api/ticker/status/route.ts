import { NextResponse } from "next/server";
import { getStatus } from "@/lab/legacy/sampler/binanceTicker";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, status: getStatus() });
}
