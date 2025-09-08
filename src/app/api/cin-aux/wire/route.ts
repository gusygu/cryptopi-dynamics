import { NextResponse } from 'next/server';
import { db } from '@/core/db';
import { compileRoutes } from '@/auxiliary/cin-aux/flow/compiler';
import { runRoutes } from '@/auxiliary/cin-aux/flow/coordinator';
import { buildCinAuxForCycle, persistCinAux } from '@/auxiliary/cin-aux/buildCinAux';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const appSessionId = searchParams.get('appSessionId') || 'dev-session';
    const cycleTsStr = searchParams.get('cycleTs');
    if (!cycleTsStr) return NextResponse.json({ error: 'cycleTs required (epoch ms)' }, { status: 400 });
    const cycleTs = Number(cycleTsStr);
    if (!Number.isFinite(cycleTs) || cycleTs <= 0) {
      return NextResponse.json({ error: 'cycleTs must be a positive number (epoch ms)' }, { status: 400 });
    }

    // 1) ensure cycle row exists
    await db.query(`insert into cycles(cycle_ts) values ($1) on conflict do nothing`, [cycleTs]);

    // 2) compile candidate routes for this cycle
    const intents = await compileRoutes(db, appSessionId, cycleTs);

    // 3) execute/confirm and write ledger rows
    await runRoutes(db, intents);

    // 4) compute + persist CIN rows for this cycle
    const rows = await buildCinAuxForCycle(db, appSessionId, cycleTs);
    await persistCinAux(db, rows);

    // return the v_cin_aux view for convenience
    const out = await db.query(
      `select * from v_cin_aux where app_session_id=$1 and cycle_ts=$2 order by symbol`,
      [appSessionId, cycleTs]
    );

    return NextResponse.json({
      appSessionId, cycleTs,
      compiled: intents.length,
      cinRows: out.rows.length,
      rows: out.rows
    });
  } catch (e: any) {
    console.error('[cin.wire] error:', e);
    return NextResponse.json({ error: e?.message || 'internal error' }, { status: 500 });
  }
}
