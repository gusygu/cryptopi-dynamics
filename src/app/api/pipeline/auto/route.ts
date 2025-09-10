export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { startAutoRefresh, stopAutoRefresh, isAutoRefreshRunning } from "@/core/pipeline";

export async function GET() {
  const started = startAutoRefresh(); // no-op if already running
  return NextResponse.json({ ok: true, running: isAutoRefreshRunning(), started }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function DELETE() {
  stopAutoRefresh();
  return NextResponse.json({ ok: true, running: isAutoRefreshRunning() }, {
    headers: { "Cache-Control": "no-store" },
  });
}
