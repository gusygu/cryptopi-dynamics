// app/api/pipeline/run-once/route.ts
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
// If you have a real builder, import it. Otherwise we just touch a no-op “heartbeat”.
import { buildAndPersistOnce } from '@/core/pipeline'; // <- keep if available

export async function POST() {
  try {
    console.log('[api] pipeline/run-once POST');
    // If you have a proper builder:
    if (typeof buildAndPersistOnce === 'function') {
      const { ts_ms, written } = await buildAndPersistOnce();
      return NextResponse.json({ ok: true, ts_ms, written }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // Fallback: return OK so the page knows the route is reachable
    return NextResponse.json({ ok: true, ts_ms: Date.now(), written: 0 }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[api] pipeline/run-once error', e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: false, error: 'POST only' }, { status: 405 });
}
