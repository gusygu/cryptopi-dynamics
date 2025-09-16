// node src/scripts/smoke/pipeline.mjs
const BASE = process.env.BASE_URL || 'http://localhost:3000';

async function jget(path, opt) {
  const r = await fetch(BASE + path, { cache: 'no-store', ...opt });
  let body = null; try { body = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, body };
}

(async () => {
  console.log('── pipeline smoke ─────────────────────────────');
  let s = await jget('/api/pipeline/auto');
  console.log('[auto status]', s.status, s.body);

  if (!s.body?.running && !s.body?.state?.running) {
    console.log('[start] POST /api/pipeline/auto?immediate=1');
    const st = await jget('/api/pipeline/auto?immediate=1', { method: 'POST' });
    console.log('[started]', st.status, st.body);
  }

  console.log('[seed] POST /api/pipeline/run-once');
  const seed = await jget('/api/pipeline/run-once', { method: 'POST' });
  console.log('[seed resp]', seed.status, seed.body);

  console.log('[head] GET /api/matrices/head');
  const head1 = await jget('/api/matrices/head');
  console.log('[head #1]', head1.status, head1.body);

  console.log('sleep 3s…'); await new Promise(r => setTimeout(r, 3000));

  console.log('[seed] POST /api/pipeline/run-once');
  const seed2 = await jget('/api/pipeline/run-once', { method: 'POST' });
  console.log('[seed resp #2]', seed2.status, seed2.body);

  const head2 = await jget('/api/matrices/head');
  console.log('[head #2]', head2.status, head2.body);

  const moved = {};
  for (const k of ['benchmark','delta','pct24h','id_pct','pct_drv']) {
    moved[k] = (head2.body?.ts?.[k] ?? 0) > (head1.body?.ts?.[k] ?? 0);
  }
  console.log('[ts advanced?]', moved);

  console.log('ok');
})();
