// JS smoke that hits the local API (no ts-node, no TS imports)
// Make sure `pnpm dev` is running on port 3000.

const ORIGIN = process.env.SMOKE_ORIGIN || "http://localhost:3000";

async function hit(qs) {
  const url = `${ORIGIN}/api/mea-aux?${qs}`;
  const t0 = Date.now();
  const res = await fetch(url, { cache: "no-store" });
  const ms = Date.now() - t0;
  const txt = await res.text();
  return { status: res.status, ms, txt };
}

async function main() {
  console.log("== wallet smoke (api) ==");
  // Use mock=1 to avoid touching real wallet; set mock=0 to test live
  const qs = new URLSearchParams({
    coins: "BTC,ETH,BNB,SOL,ADA,XRP,PEPE,USDT",
    k: "7",
    mock: "1",
  }).toString();

  // First call should do real work (or serve a fresh cache)
  let r1 = await hit(qs);
  console.log("first:", r1.status, `${r1.ms}ms`);

  // Rapid follow-ups should be super fast (API’s 40s cache)
  let r2 = await hit(qs);
  console.log("cached1:", r2.status, `${r2.ms}ms`);

  let r3 = await hit(qs);
  console.log("cached2:", r3.status, `${r3.ms}ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
