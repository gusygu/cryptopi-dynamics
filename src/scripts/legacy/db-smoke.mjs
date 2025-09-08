// node src/scripts/db-smoke.mjs
import 'dotenv/config';
import { db } from '../app/lab/aux-strategy/lib/db.js';

(async () => {
  const key = { base: 'BTC', quote: 'USDT', window: '30m', appSessionId: 'dev-session' };
  const latest = await db.getLatest(key);
  if (!latest) {
    console.log('No doc found for', key);
    process.exit(2);
  }
  console.log('OK latest doc id:', latest.id);
  console.log('updatedAt:', latest.updatedAt);
  console.log('opening:', latest.opening);
  console.log('stats keys:', Object.keys(latest.stats || {}));
})();
