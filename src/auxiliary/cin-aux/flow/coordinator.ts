import { Pool } from 'pg';
import { RouteIntent } from './compiler';
import { insertLedgerEntries } from '@/auxiliary/cin-aux/writeLedger';

/**
 * Coordinator: executes route legs in order, confirms fills, writes ledger.
 * Replace simulated fills with your real Binance client calls.
 */
export async function runRoutes(db: Pool, intents: RouteIntent[]) {
  for (const intent of intents) {
    let legSeq = 1;
    for (const leg of intent.legs) {
      // TODO: call exchange here; below is a simulated fill based on prices_usdt
      const { rows: priceFrom } = await db.query<{ price_usdt: number }>(
        `select price_usdt from prices_usdt where cycle_ts=$1 and symbol=$2`,
        [intent.cycleTs, leg.from]
      );
      const { rows: priceTo } = await db.query<{ price_usdt: number }>(
        `select price_usdt from prices_usdt where cycle_ts=$1 and symbol=$2`,
        [intent.cycleTs, leg.to]
      );

      const pf = priceFrom[0]?.price_usdt ?? 0;
      const pt = priceTo[0]?.price_usdt ?? 0;
      if (!pf || !pt) continue; // skip if we don't have prices

      // choose a notional FROM qty (toy). Plug your actual executed qty here.
      const qtyFrom = 0.1; // e.g., 0.1 from-symbol
      const qtyTo   = (qtyFrom * pf) / pt; // USDT value preserved (no fee) for demo
      const feeUsdt = 0.0; // plug actual fees

      await insertLedgerEntries(db, [{
        appSessionId: intent.appSessionId,
        cycleTs: intent.cycleTs,
        legSeq,
        fromSymbol: leg.from,
        toSymbol: leg.to,
        qtyFrom,
        qtyTo,
        priceFromUsdt: pf,
        priceToUsdt: pt,
        feeUsdt,
        execTs: Date.now(),
        routeId: intent.routeId,
        intentId: intent.routeId,
        txId: null,
      }]);

      legSeq++;
    }
  }
}
