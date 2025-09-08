import { NextResponse } from 'next/server';
import { db } from '@/core/db';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const appSessionId = searchParams.get('appSessionId') || 'dev-session';

  const latest = await db.query<{ cycle_ts: string }>(
    `select max(cycle_ts)::text as cycle_ts
     from cin_aux_cycle
     where app_session_id = $1`,
    [appSessionId]
  );
  const ts = latest.rows[0]?.cycle_ts ? Number(latest.rows[0].cycle_ts) : null;
  if (!ts) return NextResponse.json({ appSessionId, cycleTs: null, rows: [] });

  const out = await db.query(
    `select * from v_cin_aux where app_session_id=$1 and cycle_ts=$2 order by symbol`,
    [appSessionId, ts]
  );
  return NextResponse.json({ appSessionId, cycleTs: ts, rows: out.rows });
}
