// src/scripts/smoke-str-aux-snapshot.mts
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

type Argv = {
  api: string;
  coins: string;
  window: '30m'|'1h'|'3h';
  bins: number;
  session: string;
  matricesSchema: string;
  outDir?: string;
  onlyDb?: boolean;
  onlyApi?: boolean;
  onlyCalc?: boolean;
  allSchemas?: boolean;
  sampleLimit: number;
};

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
function parseArgs(): Argv {
  const a = new Map<string,string>();
  const argv = process.argv.slice(2);
  for (let i=0;i<argv.length;i++){
    const k = argv[i];
    if (k.startsWith('--')) {
      const key = k.slice(2);
      const v = argv[i+1] && !argv[i+1].startsWith('--') ? argv[++i] : 'true';
      a.set(key, v);
    }
  }
  return {
    api: a.get('api') ?? 'http://localhost:3000',
    coins: (a.get('coins') ?? process.env.COINS ?? 'BTC,ETH,SOL,ADA'),
    window: (a.get('window') as any) ?? '30m',
    bins: Number(a.get('bins') ?? 128),
    session: a.get('session') ?? 'smoke-ui',
    matricesSchema: a.get('matrices-schema') ?? a.get('matricesSchema') ?? 'matrices_dynamics',
    outDir: a.get('outDir') ?? path.resolve(process.cwd(), `artifacts/run-${ts()}`),
    onlyDb: a.has('onlyDb'),
    onlyApi: a.has('onlyApi'),
    onlyCalc: a.has('onlyCalc'),
    allSchemas: a.has('all-schemas'),
    sampleLimit: Number(a.get('sampleLimit') ?? 1000),
  };
}

async function ensureDir(p: string) { await fs.mkdir(p, { recursive: true }).catch(()=>{}); }
async function writeJson(outPath: string, data: any) {
  await ensureDir(path.dirname(outPath));
  await fs.writeFile(outPath, JSON.stringify(data, null, 2), 'utf-8');
  return outPath;
}
async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}
function mapWindowToLimit(win: '30m'|'1h'|'3h') {
  if (win === '3h') return { interval: '1m' as const, limit: 210 };
  if (win === '1h') return { interval: '1m' as const, limit: 75 };
  return { interval: '1m' as const, limit: 40 };
}
async function importFirst<T = any>(paths: string[]): Promise<T> {
  for (const p of paths) { try { return (await import(p)) as any; } catch {} }
  throw new Error(`Cannot import any of: ${paths.join(', ')}`);
}

// ---- Part 1: API doc ----
async function part1_strAuxDoc(argv: Argv, outDir: string) {
  const q = new URLSearchParams({
    coins: argv.coins, window: argv.window, bins: String(argv.bins), sessionId: argv.session,
  }).toString();
  const url = `${argv.api}/api/str-aux/bins?${q}`;
  const json = await fetchJson(url);
  const outPath = path.join(outDir, `1_str_aux.json`);
  await writeJson(outPath, { meta: { url, at: Date.now() }, data: json });
  return outPath;
}

// ---- Part 2: DB dump ----
async function part2_dbDump(argv: Argv, outDir: string) {
  let Client: any;
  try { ({ Client } = await import('pg')); } catch {
    const p = path.join(outDir, '2_db_dump.json');
    await writeJson(p, { error: 'pg module not installed', hint: 'pnpm add -D pg' });
    return p;
  }
  if (!process.env.DATABASE_URL) {
    const p = path.join(outDir, '2_db_dump.json');
    await writeJson(p, { error: 'DATABASE_URL not set' });
    return p;
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const dump: any = { meta: { at: Date.now() }, schemas: {} };

    // which schemas?
    let schemas: string[] = [];
    if (argv.allSchemas) {
      const sres = await client.query(`
        select nspname as schema
        from pg_namespace
        where nspname not in ('pg_catalog','information_schema','pg_toast')
          and nspname not like 'pg_temp_%'
        order by 1
      `);
      schemas = sres.rows.map((r:any)=>r.schema);
    } else {
      schemas = ['strategy_aux', argv.matricesSchema];
    }

    for (const schema of schemas) {
      const tablesRes = await client.query(
        `select table_name from information_schema.tables where table_schema = $1 and table_type='BASE TABLE' order by table_name`,
        [schema]
      );
      const tables: string[] = tablesRes.rows.map((r:any)=>r.table_name);
      dump.schemas[schema] = { tables, data: {} as Record<string, any> };
      for (const t of tables) {
        const countRes = await client.query(`select count(*)::int as n from "${schema}"."${t}"`);
        const n = countRes.rows[0]?.n ?? 0;
        const rowsRes = await client.query(`select * from "${schema}"."${t}" limit ${argv.sampleLimit}`);
        dump.schemas[schema].data[t] = { count: n, sample: rowsRes.rows };
      }
    }

    const p = path.join(outDir, '2_db_dump.json');
    await writeJson(p, dump);
    return p;
  } finally {
    await client.end();
  }
}

// ---- Part 3: calc steps ----
type MarketPoint = { ts: number; price: number };
async function getKlines(symbols: string[], win: '30m'|'1h'|'3h') {
  try {
    const mod: any = await importFirst(['@/sources/binanceKlines']);
    if (typeof mod.fetchMultiKlines === 'function') {
      const { interval, limit } = mapWindowToLimit(win);
      return await mod.fetchMultiKlines(symbols, interval, limit);
    }
  } catch {}
  // fallback: direct Binance
  const { interval, limit } = mapWindowToLimit(win);
  const out: Record<string, MarketPoint[]> = {};
  for (const sym of symbols) {
    const u = new URL('https://api.binance.com/api/v3/klines');
    u.searchParams.set('symbol', sym);
    u.searchParams.set('interval', interval);
    u.searchParams.set('limit', String(limit));
    const arr = await fetchJson(u.toString());
    out[sym] = (arr as any[])
  .map((k: any) => ({ ts: k[0] as number, price: Number(k[4]) } as MarketPoint))
  .filter((p: MarketPoint) => Number.isFinite(p.price));
  }
  return out;
}
async function part3_calcSteps(argv: Argv, outDir: string) {
  const bases = argv.coins.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const symbols = bases.map(b => `${b}USDT`);
  const klinesMap = await getKlines(symbols, argv.window);

  const idhrMod: any  = await importFirst(['@/core/str-aux/idhr','@/lab/str-aux/idhr']);
  const sessMod: any  = await importFirst(['@/core/str-aux/session','@/lab/str-aux/session']);
  const { computeIdhrBinsN, computeFloatingModeIDHR, serializeIdhr } = idhrMod;
  const { getOrInitSymbolSession, updateSymbolSession } = sessMod;

  const outPaths: string[] = [];
  for (const sym of symbols) {
    const pts: MarketPoint[] = (klinesMap[sym] ?? []).filter(
  (p: MarketPoint) => Number.isFinite(p.price) && p.price > 0
);
    if (pts.length < 5) continue;

    const opening = { benchmark: pts[0].price, pct24h: 0, id_pct: 0, ts: pts[0].ts, layoutHash: 'smoke:audit' };
    const N = argv.bins;
    const idhr = computeIdhrBinsN(pts, opening, { topN: 3 }, N);
    const fm   = computeFloatingModeIDHR(pts, opening, { totalBins: N, topN: 3 });

    const ss = getOrInitSymbolSession('smoke-audit', sym, opening.benchmark, opening.ts, /*eta*/0.05, /*eps*/0.2, /*K*/8);
    const steps: any[] = [];
    for (let i = 0; i < pts.length; i++) {
      const slice = pts.slice(0, i+1);
      const fmi = computeFloatingModeIDHR(slice, opening, { totalBins: N, topN: 3 });
      const gfmPrice = opening.benchmark * Math.exp(fmi.gfm);
      const last = slice[slice.length - 1];
      const upd = updateSymbolSession(ss, last.price, last.ts, gfmPrice, /*pct24h*/0);
      steps.push({
        i, ts: last.ts, price: last.price, gfm_price: gfmPrice,
        benchPct: upd.benchPct, pct_drv: upd.pctDrv, gfmDeltaAbsPct: upd.gfmDeltaAbsPct,
        anchor: ss.gfmAnchorPrice ?? null, aboveCount: ss.aboveCount, belowCount: ss.belowCount,
        isShift: upd.isShift, swaps: ss.swaps, shifts: ss.shifts,
      });
    }

    const audit = {
      symbol: sym,
      config: { window: argv.window, bins: N, etaPct: 0.05, epsShiftPct: 0.2, K: 8 },
      idhr: serializeIdhr(idhr),
      fm: {
        gfm_r: fm.gfm,
        gfm_price: opening.benchmark * Math.exp(fm.gfm),
        sigma: fm.sigmaGlobal, zAbs: fm.zMeanAbs,
        vInner: fm.vInner, vOuter: fm.vOuter, inertia: fm.inertia, disruption: fm.disruption,
        nuclei: fm.nuclei ?? [],
      },
      sessionFinal: {
        openingPrice: ss.openingPrice, priceMin: ss.priceMin, priceMax: ss.priceMax,
        benchPctMin: ss.benchPctMin, benchPctMax: ss.benchPctMax, swaps: ss.swaps, shifts: ss.shifts,
        anchorPrice: ss.gfmAnchorPrice ?? null,
      },
      steps,
    };
    const p = path.join(outDir, `3_calc_steps_${sym}.json`);
    await writeJson(p, { meta: { at: Date.now() }, audit });
    outPaths.push(p);
  }
  return outPaths;
}

// ---- main ----
(async () => {
  const argv = parseArgs();
  const outDir = path.resolve(argv.outDir!);
  await ensureDir(outDir);

  const tasks = [];
  if (!argv.onlyDb && !argv.onlyApi && !argv.onlyCalc) {
    tasks.push('api','db','calc');
  } else {
    if (argv.onlyApi) tasks.push('api');
    if (argv.onlyDb)  tasks.push('db');
    if (argv.onlyCalc) tasks.push('calc');
  }

  const paths: string[] = [];
  if (tasks.includes('api'))  paths.push(await part1_strAuxDoc(argv, outDir));
  if (tasks.includes('db'))   paths.push(await part2_dbDump(argv, outDir));
  if (tasks.includes('calc')) paths.push(...(await part3_calcSteps(argv, outDir)));

  await writeJson(path.join(outDir, '_index.json'), { generatedAt: new Date().toISOString(), files: paths });
  console.log(`OK — artifacts written to ${outDir}`);
})().catch(e => { console.error('SMOKE SNAPSHOT FAILED:', e); process.exit(1); });
