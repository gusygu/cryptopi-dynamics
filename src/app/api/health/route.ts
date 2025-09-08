// src/app/api/health/route.ts
import { NextResponse } from 'next/server';
import { pool } from '@/core/db';
import { Report, ReportItem, summarizeReport } from '@/lib/types';

export async function GET() {
  try {
    const now = Date.now();
    let dbOk = false, dbNow: string | null = null;

    try {
      const r = await pool.query('select now() as now');
      dbNow = r.rows?.[0]?.now ?? null;
      dbOk = true;
    } catch {}

    const items: ReportItem[] = [
      { key: 'api:up', label: 'API server', level: 'ok', value: true, ts: now },
      { key: 'db:pool', label: 'DB pool', level: dbOk ? 'ok' : 'err', value: dbNow, ts: now },
      { key: 'env:coins', label: 'Env coins', level: process.env.COINS ? 'ok' : 'warn', value: process.env.COINS ?? null, ts: now },
      { key: 'env:bridge', label: 'Bridge mode', level: 'ok', value: process.env.BRIDGE_MODE ?? null, ts: now },
      { key: 'env:poll', label: 'Poll interval', level: 'ok', value: Number(process.env.POLL_INTERVAL_MS ?? 40000), ts: now },
    ];

    const report: Report = {
      id: 'health:' + now,
      scope: 'system',
      items,
      summary: summarizeReport(items),
      ts: now,
    };

    return NextResponse.json(report);
  } catch (e: any) {
    return NextResponse.json({ id: 'health:error', scope: 'system', items: [], ts: Date.now(), error: e?.message ?? String(e) }, { status: 500 });
  }
}
