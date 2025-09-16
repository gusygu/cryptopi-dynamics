const BASE=(process.env.BASE_URL||"http://localhost:3000").replace(/\/+$/,"");
const WINDOW=(process.env.SMOKE_WINDOW||"30m"); const BINS=Number(process.env.SMOKE_BINS||64)||64;
const jget=async p=>{const u=BASE+p;const r=await fetch(u);return {u,s:r.status,j:JSON.parse(await r.text())};};

(async()=>{
  const set=await jget("/api/settings");
  const coins=(set.j?.coinUniverse||process.env.SMOKE_COINS?.split(",")||["BTC","ETH","USDT"]).map(s=>String(s).trim().toUpperCase());
  const {j}=await jget(`/api/str-aux/bins?coins=${coins.join(",")}&window=${WINDOW}&bins=${BINS}&epsilonPct=0.2&secondaryMs=2500&sessionId=smoke`);
  const sym=j?.symbols?.[0];
  console.log("str-aux:", { coinsWanted: coins.length, symbols: j?.symbols?.length||0, sample: sym, selected: j?.selected?.length||0, availUsdt: j?.available?.usdt?.length||0 });
  if(!j||j.ok===false||!sym) process.exit(1);
})();
