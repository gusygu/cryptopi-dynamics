// TS smoke that calls the TS source directly (uses ts-node/esm loader)
import { getAccountBalances, clearWalletCache } from "@/sources/binanceAccount";

async function main() {
  console.log("== wallet smoke (ts-node) ==");

  console.time("first");
  const a = await getAccountBalances();
  console.timeEnd("first");
  console.log("balances:", a);

  console.time("cached");
  const b = await getAccountBalances(); // 40s cache => near-instant
  console.timeEnd("cached");
  console.log("balances (cached):", b);

  // optional: force refresh (demonstrates cache reset)
  clearWalletCache();
  console.time("after-clear");
  const c = await getAccountBalances();
  console.timeEnd("after-clear");
  console.log("balances (after clear):", c);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
