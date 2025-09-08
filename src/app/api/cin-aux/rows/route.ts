import { NextResponse } from 'next/server';
import { db } from '@/core/db';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const appSessionId = searchParams.get('appSessionId') || 'dev-session';
  const cycleTsStr = searchParams.get('cycleTs');
  const cycleTs = Number(cycleTsStr || '');

  if (!Number.isFinite(cycleTs) || cycleTs <= 0) {
    return NextResponse.json({ error: 'cycleTs must be a positive number (epoch ms)' }, { status: 400 });
  }

  const out = await db.query(
    `select * from v_cin_aux where app_session_id=$1 and cycle_ts=$2 order by symbol`,
    [appSessionId, cycleTs]
  );
  return NextResponse.json({ appSessionId, cycleTs, rows: out.rows });
}
