import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const SSL = String(process.env.PGSSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined;
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, ssl: SSL });

const APP_SESSION_ID = process.env.APP_SESSION_ID || 'dev-session';
const CYCLE_TS = process.env.CYCLE_TS ? Number(process.env.CYCLE_TS) : null;
const WIPE_IDPCT = String(process.env.WIPE_IDPCT || 'true').toLowerCase() === 'true';
const DRY_RUN = String(process.env.DRY_RUN || 'false').toLowerCase() === 'true';

async function tableExists(name){
  const { rows } = await db.query(`select to_regclass($1) as reg`, [`public.${name}`]);
  return !!rows[0]?.reg;
}

async function getSeededCyclesForSession(sessionId){
  if (CYCLE_TS) return [CYCLE_TS];
  const { rows } = await db.query(
    `select distinct cycle_ts from (
       select cycle_ts from wallet_snapshots where app_session_id=$1
       union
       select cycle_ts from transfer_ledger where app_session_id=$1
       union
       select cycle_ts from cin_aux_cycle where app_session_id=$1
     ) t order by cycle_ts desc`,
    [sessionId]
  );
  return rows.map(r => Number(r.cycle_ts));
}

async function wipeDevSeedData(sessionId){
  const cycles = await getSeededCyclesForSession(sessionId);
  if (!cycles.length) {
    console.log(`[wipe] no cycles found for app_session_id=${sessionId}`);
    return { cycles: [] };
  }

  for (const ts of cycles) {
    console.log(`[wipe] cycle_ts=${ts} for app_session_id=${sessionId}`);
    const del = async (sql, params) => {
      if (DRY_RUN) { console.log('[dry-run]', sql, params); return; }
      await db.query(sql, params);
    };

    await del(`delete from transfer_ledger where app_session_id=$1 and cycle_ts=$2`, [sessionId, ts]);
    await del(`delete from cin_aux_cycle where app_session_id=$1 and cycle_ts=$2`, [sessionId, ts]);
    await del(`delete from wallet_snapshots where app_session_id=$1 and cycle_ts=$2`, [sessionId, ts]);
    await del(`delete from prices_usdt where cycle_ts=$1`, [ts]);
    await del(`delete from mea_orientations where cycle_ts=$1`, [ts]);
    await del(`delete from cycles where cycle_ts=$1`, [ts]);
  }

  if (!DRY_RUN) {
    // Drop app_session if fully orphaned in known tables
    await db.query(
      `delete from app_sessions s
       where s.app_session_id=$1
         and not exists (select 1 from wallet_snapshots where app_session_id=s.app_session_id)
         and not exists (select 1 from transfer_ledger where app_session_id=s.app_session_id)
         and not exists (select 1 from cin_aux_cycle where app_session_id=s.app_session_id)
         and not exists (select 1 from binance_balances_raw where app_session_id=s.app_session_id)
         and not exists (select 1 from binance_trades_raw where app_session_id=s.app_session_id)
      `,
      [sessionId]
    );
  } else {
    console.log('[dry-run] would delete orphaned app_session if no references');
  }

  return { cycles };
}

async function wipeIdPctSeeds(){
  if (!WIPE_IDPCT) {
    console.log('[wipe] WIPE_IDPCT=false; skipping dyn_matrix_values cleanup');
    return { removedTs: [] };
  }
  if (!await tableExists('dyn_matrix_values')) {
    console.log('[wipe] table dyn_matrix_values does not exist; skipping');
    return { removedTs: [] };
  }
  const arr = ['BTC','ETH','BNB','SOL','ADA','XRP','PEPE','USDT'];
  const expected = arr.length * (arr.length - 1); // 56
  const { rows } = await db.query(
    `select ts_ms, count(*) as c
       from dyn_matrix_values
      where matrix_type='id_pct'
        and base = any($1::text[])
        and quote = any($1::text[])
        and base <> quote
      group by ts_ms
      having count(*) = $2
      order by ts_ms desc`,
    [arr, expected]
  );
  const tsList = rows.map(r => Number(r.ts_ms));
  if (!tsList.length) {
    console.log('[wipe] no id_pct seed batches detected in dyn_matrix_values');
    return { removedTs: [] };
  }
  console.log('[wipe] removing id_pct seed batches at ts_ms:', tsList.join(', '));
  if (!DRY_RUN) {
    await db.query(
      `delete from dyn_matrix_values
        where matrix_type='id_pct'
          and base = any($1::text[])
          and quote = any($1::text[])
          and base <> quote
          and ts_ms = any($2::bigint[])`,
      [arr, tsList]
    );
  } else {
    console.log('[dry-run] would delete from dyn_matrix_values for ts_ms:', tsList);
  }
  return { removedTs: tsList };
}

async function main(){
  console.log('[wipe] starting with app_session_id=', APP_SESSION_ID, 'cycleTs=', CYCLE_TS ?? '(auto)');
  const a = await wipeDevSeedData(APP_SESSION_ID);
  const b = await wipeIdPctSeeds();
  console.log('[wipe] complete. cycles wiped:', a.cycles, 'id_pct batches removed:', b.removedTs);
  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
