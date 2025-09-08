// scripts/peek-latest.ts  (update imports to src/*)
import { pool } from '@/core/db';
async function main() {
  const base = (process.argv[2] ?? 'BTC').toUpperCase();
  const quote = (process.argv[3] ?? 'ETH').toUpperCase();
  const types = ['benchmark','delta','pct24h','id_pct','pct_drv'] as const;
  for (const t of types) {
    const { rows } = await pool.query(
      `select ts_ms, value from matrix_values where matrix_type=$1 and base=$2 and quote=$3 order by ts_ms desc limit 1`,
      [t, base, quote]
    );
    if (!rows.length) console.log(`${t.padEnd(10)}: (no data)`);
    else console.log(`${t.padEnd(10)}: ${rows[0].value.toFixed(6)} @ ${new Date(rows[0].ts_ms).toISOString()}`);
  }
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
