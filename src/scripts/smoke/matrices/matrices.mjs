const BASE=(process.env.BASE_URL||"http://localhost:3000").replace(/\/+$/,"");
const jget=async p=>{const u=BASE+p;const r=await fetch(u);return {u,s:r.status,j:JSON.parse(await r.text())};};

(async()=>{
  const set=await jget("/api/settings");
  const coins=(set.j?.coinUniverse||process.env.SMOKE_COINS?.split(",")||["BTC","ETH","USDT"]).map(s=>String(s).trim().toUpperCase());
  const {j}=await jget(`/api/matrices/latest?coins=${coins.join(",")}&loopMs=1500`);
  console.log("matrices:", { coinsEcho: j?.coins?.length, coinsWanted: coins.length, types: Object.keys(j?.matrices||{}) });
  if(!j||j.ok===false) process.exit(1);
})();
