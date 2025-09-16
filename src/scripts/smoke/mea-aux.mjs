const BASE=(process.env.BASE_URL||"http://localhost:3000").replace(/\/+$/,"");
const jget=async p=>{const u=BASE+p;const r=await fetch(u);return {u,s:r.status,j:JSON.parse(await r.text())};};

(async()=>{
  const set=await jget("/api/settings");
  const coins=(set.j?.coinUniverse||process.env.SMOKE_COINS?.split(",")||["BTC","ETH","USDT"]).map(s=>String(s).trim().toUpperCase());
  const {j}=await jget(`/api/mea-aux?coins=${coins.join(",")}&ttlMs=1&rateWindowMs=5000&rateMax=50&loopMs=1200&sessionStamp=smoke`);
  console.log("mea-aux:", { coinsEcho: j?.coins?.length, coinsWanted: coins.length, k: j?.k, warns: j?.meta?.warnings?.length||0 });
  if(!j||j.ok===false) process.exit(1);
})();
