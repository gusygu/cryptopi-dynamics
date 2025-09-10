import { NextResponse } from 'next/server';
import { db } from '@/core/db';
import { compileRoutes } from '@/auxiliary/cin-aux/flow/compiler';
import { runRoutes } from '@/auxiliary/cin-aux/flow/coordinator';
import { buildCinAuxForCycle, persistCinAux } from '@/auxiliary/cin-aux/buildCinAux';
import { getAll as getSettings } from '@/lib/settings/server';

function normCoins(input: string | null | undefined, settingsCoins: string[]): string[] {
  const list = (input ? input.split(',') : settingsCoins)
    .map(s => String(s || '').trim().toUpperCase())
    .filter(Boolean);
  const seen = new Set<string>();
  return list.filter(c => !seen.has(c) && seen.add(c));
}
function coinsRegex(coins: string[]): string | null {
  if (!coins?.length) return null;
  return `^(${coins.join('|')})`;
}

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

    // 5) filter final view by coin selector (query or Settings)
    const settings = await getSettings();
    const coins = normCoins(searchParams.get('coins'), settings.coinUniverse ?? []);
    const rx = coinsRegex(coins);

    const sql = rx
      ? `select * from v_cin_aux
           where app_session_id=$1 and cycle_ts=$2 and symbol ~ $3
           order by symbol`
      : `select * from v_cin_aux
           where app_session_id=$1 and cycle_ts=$2
           order by symbol`;

    const args: any[] = [appSessionId, cycleTs];
    if (rx) args.push(rx);

    const out = await db.query(sql, args);

    return NextResponse.json({
      appSessionId, cycleTs,
      compiled: intents.length,
      cinRows: out.rows.length,
      rows: out.rows,
      coins
    });
  } catch (e: any) {
    console.error('[cin.wire] error:', e);
    return NextResponse.json({ error: e?.message || 'internal error' }, { status: 500 });
  }
}
