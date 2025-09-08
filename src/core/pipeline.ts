import { fetch24hAll, mapTickerBySymbol } from '@/sources/binance';
import { buildPrimaryDirect, buildDerived } from '@/core/math/matrices';
import { upsertMatrixRows, getPrevValue } from '@/core/db';
import { log } from '@/core/logger';

const coins = (process.env.COINS ?? 'BTC,ETH,BNB,SOL,ADA,XRP,DOGE,USDT')
  .split(',').map(s=>s.trim().toUpperCase());
const intervalMs = Number(process.env.POLL_INTERVAL_MS ?? 40000);

let _timer: NodeJS.Timeout | null = null;
let _running = false;

export async function buildAndPersistOnce() {
  const ts_ms = Date.now();
  const rows = await fetch24hAll();                 // public 24h endpoint (no keys)
  const tmap = mapTickerBySymbol(rows);

  const { benchmark, pct24h, delta } = buildPrimaryDirect(coins, tmap);
  const { id_pct, pct_drv } = await buildDerived(
    coins,
    ts_ms,
    benchmark,
    (mt, base, quote, beforeTs) => getPrevValue(mt, base, quote, beforeTs)
  );

  const payload: Parameters<typeof upsertMatrixRows>[0] = [];
  const types = ['benchmark','delta','pct24h','id_pct','pct_drv'] as const;

  for (let i=0;i<coins.length;i++){
    for (let j=0;j<coins.length;j++){
      if (i===j) continue;
      const A=coins[i], B=coins[j];
      const vals: Record<string, number> = {
        benchmark: (benchmark[i][j] ?? 0),
        delta:     (delta[i][j] ?? 0),
        pct24h:    (pct24h[i][j] ?? 0),
        id_pct:    (id_pct[i][j] ?? 0),
        pct_drv:   (pct_drv[i][j] ?? 0)
      };
      for (const t of types){
        const v = vals[t];
        if (!Number.isFinite(v)) continue;
        payload.push({ ts_ms, matrix_type: t, base: A, quote: B, value: v, meta: { mode: 'direct-only', coins } });
      }
    }
  }

  await upsertMatrixRows(payload);
  log.info(`[pipeline] wrote ${payload.length} rows @ ${new Date(ts_ms).toISOString()}`);
  return { ts_ms, written: payload.length };
}

// non-overlapping loop aligned to intervalMs
export function startAutoRefresh() {
  if (_timer) return false;

  const loop = async () => {
    if (_running) {
      // a previous cycle is still running; try again next tick
      _timer = setTimeout(loop, intervalMs);
      return;
    }
    _running = true;
    const started = Date.now();
    try {
      await buildAndPersistOnce();
    } catch (e) {
      log.error('[pipeline]', e);
    } finally {
      _running = false;
      const elapsed = Date.now() - started;
      const wait = Math.max(0, intervalMs - elapsed);
      _timer = setTimeout(loop, wait);
    }
  };

  _timer = setTimeout(loop, 0); // fire immediately
  log.info(`[pipeline] auto-refresh started (${intervalMs} ms)`);
  return true;
}

export function stopAutoRefresh() {
  if (_timer) clearTimeout(_timer);
  _timer = null;
}

export function isAutoRefreshRunning() {
  return _timer != null;
}
