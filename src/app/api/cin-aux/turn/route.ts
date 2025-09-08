import { NextResponse } from 'next/server';
import { db } from '@/db/pool'; // adjust to your pool export
import { buildCinAuxForCycle, persistCinAux } from '@/auxiliary/cin-aux/buildCinAux';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const appSessionId = searchParams.get('appSessionId') || 'dev-session';
    const cycleTsStr = searchParams.get('cycleTs');
    if (!cycleTsStr) {
      return NextResponse.json({ error: 'cycleTs required (epoch ms)' }, { status: 400 });
    }
    const cycleTs = Number(cycleTsStr);
    if (!Number.isFinite(cycleTs) || cycleTs <= 0) {
      return NextResponse.json({ error: 'cycleTs must be a positive number (epoch ms)' }, { status: 400 });
    }

    // 1) compute + persist
    const rows = await buildCinAuxForCycle(db, appSessionId, cycleTs);
    await persistCinAux(db, rows);

    // 2) read the composed view
    const out = await db.query(
      `select *
         from v_cin_aux
        where app_session_id = $1
          and cycle_ts = $2
        order by symbol`,
      [appSessionId, cycleTs]
    );

    return NextResponse.json({ appSessionId, cycleTs, rows: out.rows });
  } catch (e: any) {
    console.error('[cin.turn] error:', e);
    return NextResponse.json({ error: e?.message || 'internal error' }, { status: 500 });
  }
}
