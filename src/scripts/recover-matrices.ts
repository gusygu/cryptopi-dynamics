import 'dotenv/config';
import { buildAndPersistOnce, startAutoRefresh } from '@/core/pipeline';

const mode = (process.argv[2] || 'once').toLowerCase();

async function main() {
  if (mode === 'auto') {
    startAutoRefresh();
    // keep process alive
    // eslint-disable-next-line no-console
    console.log('[recover-matrices] auto-refresh running. CTRL+C to stop.');
    process.stdin.resume();
    return;
  }

  const { ts_ms, written } = await buildAndPersistOnce();
  // eslint-disable-next-line no-console
  console.log(`[recover-matrices] wrote ${written} rows at ${new Date(ts_ms).toISOString()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

