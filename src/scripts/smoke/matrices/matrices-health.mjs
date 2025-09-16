// node src/scripts/smoke/matrices-health.mjs
const BASE = process.env.BASE_URL || 'http://localhost:3000';

(async () => {
  const u = new URL('/api/matrices/latest', BASE);
  const r = await fetch(u, { cache: 'no-store' });
  const j = await r.json();
  if (!r.ok || j.ok === false) {
    console.error('latest failed', r.status, j);
    process.exit(2);
  }

  const coins = j.coins || [];
  console.log('coins:', coins.join(', '));

  const kinds = ['benchmark','delta','pct24h','id_pct','pct_drv'];
  for (const k of kinds) {
    const M = j.matrices?.[k] || [];
    let nonNull = 0, total = 0, antiBad = 0;
    for (let i=0;i<M.length;i++){
      for (let j2=0;j2<M.length;j2++){
        if (i===j2) continue;
        const v = M[i]?.[j2];
        total++; if (v!=null && Number.isFinite(v)) nonNull++;
        const vij = v, vji = M[j2]?.[i];
        if (vij!=null && vji!=null && Number.isFinite(vij) && Number.isFinite(vji)) {
          // antisym check for percent-like sets (skip benchmark)
          if (k !== 'benchmark') {
            const sum = Math.abs(vij + vji);
            if (sum > 1e-8) antiBad++;
          }
        }
      }
    }
    console.log(`${k}: filled ${nonNull}/${total} (${((nonNull/Math.max(1,total))*100).toFixed(1)}%)` +
                (k !== 'benchmark' ? `, antisym bad: ${antiBad}` : ''));
  }
})();
