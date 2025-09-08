import 'dotenv/config';
import pgPkg from 'pg';
const { Pool } = pgPkg;

const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

const appSessionId = process.env.APP_SESSION_ID || 'dev-session';
const cycleTs = Number(process.env.CYCLE_TS || Date.now());
const ADD_LEDGER = String(process.env.ADD_LEDGER || 'false').toLowerCase() === 'true';

const prices = (() => { try { return JSON.parse(process.env.PRICES_JSON || '[]'); } catch { return []; } })();
const balances = (() => { try { return JSON.parse(process.env.WALLET_JSON || '[]'); } catch { return []; } })();
const mea = (() => { try { return JSON.parse(process.env.MEA_JSON || '[]'); } catch { return []; } })();

async function upsertCoins(symbols){ for(const s of symbols){await db.query(`insert into coins(symbol) values ($1) on conflict do nothing`,[s]);} }
async function upsertWallet(){
  const b = balances.length ? balances : [{asset:'BTC',qty:0.25},{asset:'ETH',qty:4.2},{asset:'USDT',qty:4200}];
  for(const x of b){
    await db.query(
      `insert into wallet_snapshots(app_session_id,cycle_ts,symbol,qty)
       values ($1,$2,$3,$4)
       on conflict (app_session_id,cycle_ts,symbol) do update set qty=excluded.qty`,
      [appSessionId,cycleTs,x.asset,Number(x.qty)]
    );
  }
}
async function upsertPrices(){
  const p = prices.length ? prices : [{symbol:'BTC',price_usdt:61234},{symbol:'ETH',price_usdt:3275},{symbol:'USDT',price_usdt:1}];
  for(const t of p){
    await db.query(
      `insert into prices_usdt(cycle_ts,symbol,price_usdt)
       values ($1,$2,$3)
       on conflict (cycle_ts,symbol) do update set price_usdt=excluded.price_usdt`,
      [cycleTs,t.symbol,Number(t.price_usdt)]
    );
  }
}
async function writeMea(){
  const rows = mea.length ? mea : [
    {base:'BTC',quote:'USDT',metric:'id_pct',value:0.0016},
    {base:'ETH',quote:'USDT',metric:'id_pct',value:0.0011},
  ];
  for(const r of rows){
    await db.query(
      `insert into mea_orientations(cycle_ts,base,quote,metric,value)
       values ($1,$2,$3,$4,$5) on conflict do nothing`,
      [cycleTs,r.base,r.quote,r.metric||'id_pct',Number(r.value)]
    );
  }
}
async function seedLedger(){
  await db.query(
    `insert into transfer_ledger
     (app_session_id,cycle_ts,leg_seq,route_id,intent_id,from_symbol,to_symbol,qty_from,qty_to,price_from_usdt,price_to_usdt,fee_usdt,exec_ts,tx_id)
     values
     ($1,$2,1,'rt-dev','rt-dev','BTC','USDT',0.05, 3061.7, 61234, 1, 0.2, $3, 'dev-t1'),
     ($1,$2,2,'rt-dev','rt-dev','USDT','ETH',3061.7, 0.935, 1, 3275, 0.2, $3, 'dev-t2')
     on conflict do nothing`,
    [appSessionId,cycleTs,Date.now()]
  );
}

async function main(){
  await db.query(`insert into app_sessions(app_session_id) values ($1) on conflict do nothing`,[appSessionId]);
  await db.query(`insert into cycles(cycle_ts) values ($1) on conflict do nothing`,[cycleTs]);
  await upsertCoins(['BTC','ETH','USDT']);
  await upsertWallet();
  await upsertPrices();
  await writeMea();
  if(ADD_LEDGER){ await seedLedger(); }
  const { rows } = await db.query(
    `select * from v_cin_aux where app_session_id=$1 and cycle_ts=$2 order by symbol`,
    [appSessionId,cycleTs]
  );
  console.log('[dev-seed] cycle', cycleTs, 'rows', rows.length, rows);
  await db.end();
}
main().catch(e=>{console.error(e);process.exit(1);});
