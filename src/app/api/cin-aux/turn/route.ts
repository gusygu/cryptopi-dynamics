import { NextResponse } from 'next/server';
import { db } from '@/db/pool'; // keep your pool export
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
    if (!cycleTsStr) {
      return NextResponse.json({ error: 'cycleTs required (epoch ms)' }, { status: 400 });
    }
    const cycleTs = Number(cycleTsStr);
    if (!Number.isFinite(cycleTs) || cycleTs <= 0) {
      return NextResponse.json({ error: 'cycleTs must be a positive number (epoch ms)' }, { status: 400 });
    }

    // 1) compute + persist (unchanged)
    const rows = await buildCinAuxForCycle(db, appSessionId, cycleTs);
    await persistCinAux(db, rows);

    // 2) resolve coins and apply filter when reading the composed view
    const settings = await getSettings();
    const coins = normCoins(searchParams.get('coins'), settings.coinUniverse ?? []);
    const rx = coinsRegex(coins);

    const sql = rx
      ? `select *
           from v_cin_aux
          where app_session_id = $1
            and cycle_ts = $2
            and symbol ~ $3
          order by symbol`
      : `select *
           from v_cin_aux
          where app_session_id = $1
            and cycle_ts = $2
          order by symbol`;

    const args: any[] = [appSessionId, cycleTs];
    if (rx) args.push(rx);

    const out = await db.query(sql, args);

    return NextResponse.json({ appSessionId, cycleTs, rows: out.rows, coins });
  } catch (e: any) {
    console.error('[cin.turn] error:', e);
    return NextResponse.json({ error: e?.message || 'internal error' }, { status: 500 });
  }
}
