import { startUnifiedPoller } from '../poller';
import { getAccountBalances } from '../sources/binanceAccount';
import { fetch24hAll } from '../sources/binance';

// map account balances → { balances:[{asset, qty}] }
async function fetchBalances() {
  const m = await getAccountBalances();            // Record<symbol, number>
  const balances = Object.entries(m).map(([asset, qty]) => ({ asset, qty }));
  return { balances };
}

// map 24h tickers → [{symbol, price_usdt}]
async function fetchPricesUSDT() {
  const all = await fetch24hAll();                 // e.g. BTCUSDT, ETHUSDT...
  const out: { symbol: string; price_usdt: number }[] = [];
  for (const t of all) {
    const s = t.symbol.toUpperCase();
    if (s.endsWith('USDT')) {
      const base = s.slice(0, -4);                 // drop 'USDT'
      const price = Number(t.lastPrice);
      if (Number.isFinite(price)) out.push({ symbol: base, price_usdt: price });
    }
  }
  // ensure USDT=1
  out.push({ symbol: 'USDT', price_usdt: 1 });
  return out;
}

const provider = {
  fetchBalances,
  fetchPricesUSDT,
  // fetchMeaOrientations: optional; omit for now (MEA writes elsewhere)
};

startUnifiedPoller({
  appSessionId: process.env.APP_SESSION_ID || 'dev-session',
  intervalMs: Number(process.env.POLL_MS || 40000),
  runCoordinator: String(process.env.RUN_COORDINATOR || 'false').toLowerCase() === 'true',
  provider,
});
