// src/app/api/str-aux/route.ts
import { NextResponse } from "next/server";
import { runStrAux } from "@/str-aux/run";

export async function GET() {
  const snap = await runStrAux();
  return NextResponse.json(snap, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
