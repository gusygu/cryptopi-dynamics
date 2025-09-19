'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import HomeBar from '@/components/HomeBar';
import Matrix from '@/components/Matrix';
import type { Kind, MatFlags } from '@/components/Matrix';
import { useSettings } from '@/lib/settings/provider';
import { subscribe, getState } from '@/lib/pollerClient';

type TKey = Kind;
type Num = number;
type Grid = (number | null)[][];

type LatestPayload = {
  ok?: boolean;
  coins?: string[];
  matrices?: Partial<Record<TKey, Grid | Record<string, unknown>>>;
  flags?: Partial<Record<TKey, MatFlags>>;
  ts?: Partial<Record<TKey, number>>;
  prevTs?: Partial<Record<TKey, number>>;
};

const TYPES: TKey[] = ['benchmark', 'delta', 'pct24h', 'id_pct', 'pct_drv'];

const up = (s: unknown): string => String(s ?? '').toUpperCase();

function toGrid(g: unknown, coins: string[]): Grid {
  const n = coins.length;
  if (Array.isArray(g)) return g as Grid;

  const out: Grid = Array.from({ length: n }, () => Array(n).fill(null));
  if (!g || typeof g !== 'object') return out;

  const idx: Record<string, number> = Object.fromEntries(
    coins.map((c: string, i: number): [string, number] => [up(c), i])
  );

  for (const b of Object.keys(g as Record<string, unknown>)) {
    const i = idx[up(b)];
    if (i == null) continue;
    const row = (g as Record<string, unknown>)[b];

    if (Array.isArray(row)) {
      for (let j = 0; j < Math.min(n, row.length); j++) {
        const vv = Number((row as Array<unknown>)[j]);
        out[i][j] = Number.isFinite(vv) ? vv : null;
      }
    } else if (row && typeof row === 'object') {
      const robj = row as Record<string, unknown>;
      for (const q of Object.keys(robj)) {
        const j = idx[up(q)];
        if (j == null) continue;
        const vv = Number(robj[q] as Num);
        out[i][j] = Number.isFinite(vv) ? vv : null;
      }
    }
  }
  return out;
}

function normalizeLatest(j: LatestPayload, coins: string[]): {
  matrices: Required<LatestPayload>['matrices'];
  flags: Required<LatestPayload>['flags'];
  ts: Required<LatestPayload>['ts'];
  prevTs: Required<LatestPayload>['prevTs'];
} {
  const matsIn = j?.matrices ?? {};
  const mats = {
    benchmark: toGrid(matsIn?.benchmark, coins),
    delta:     toGrid(matsIn?.delta,     coins),
    pct24h:    toGrid(matsIn?.pct24h,    coins),
    id_pct:    toGrid(matsIn?.id_pct,    coins),
    pct_drv:   toGrid(matsIn?.pct_drv,   coins),
  };

  // derive id_pct ≈ delta / benchmark where missing
  const n = coins.length;
  const id = mats.id_pct, d = mats.delta, bm = mats.benchmark;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const idv = id[i][j];
      if (idv == null && Number.isFinite(d[i][j] as Num) && Number.isFinite(bm[i][j] as Num) && (bm[i][j] as Num) !== 0) {
        id[i][j] = Number(d[i][j]) / Number(bm[i][j]);
      }
    }
  }

  const flags = j?.flags ?? {};
  const ts = j?.ts ?? {};
  const prevTs = j?.prevTs ?? {};
  return { matrices: mats, flags, ts, prevTs };
}

const prettyTs = (ts?: number | null) => (ts ? new Date(ts).toLocaleString() : '—');

export default function MatricesPage() {
  const { settings } = useSettings();

  const coins = useMemo<string[]>(
    () =>
      (Array.isArray(settings?.coinUniverse) && settings.coinUniverse.length
        ? settings.coinUniverse
        : ['BTC','ETH','BNB','SOL','ADA','DOGE','USDT','PEPE','BRL']
      ).map((c: string) => up(c)),
    [settings?.coinUniverse]
  );

  const [baseMs, setBaseMs] = useState<number>(() => {
    try { return Math.max(1000, (getState().dur40 as number) * 1000); } catch { return 40000; }
  });
  const [autoUI, setAutoUI] = useState<boolean>(true);
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);

  const [data, setData] = useState<ReturnType<typeof normalizeLatest> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const fetchOnce = useCallback(async (opts?: { signal?: AbortSignal }) => {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams();
      if (coins.length) qs.set('coins', coins.join(','));
      let r = await fetch(`/api/matrices/head?${qs}`, { cache: 'no-store', signal: opts?.signal });
      if (!r.ok) {
        // graceful fallback keeps you working in older envs
        r = await fetch(`/api/matrices/latest?${qs}`, { cache: 'no-store', signal: opts?.signal });
      }
      const j = (await r.json()) as LatestPayload;
      if (!r.ok || j?.ok === false) throw new Error((j as any)?.error ?? `HTTP ${r.status}`);
      const coinsFromResp = Array.isArray(j.coins) ? j.coins.map(up) : coins;
      setData(normalizeLatest(j, coinsFromResp));
      setLastFetchAt(Date.now());
    } catch (e: any) {
      const name = e?.name ?? '';
      const msg = e?.message ?? String(e ?? '');
      if (name === 'AbortError' || /aborted/i.test(msg)) return;
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }, [coins]);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();

    (async () => {
      if (!cancelled) await fetchOnce({ signal: ac.signal });
    })();

    const unsub = subscribe((ev: any) => {
      if (ev?.type === 'state') {
        const ms = Number(ev?.state?.dur40) * 1000;
        if (Number.isFinite(ms)) setBaseMs(Math.max(1000, ms));
      } else if (ev?.type === 'tick40' || ev?.type === 'refresh') {
        if (autoUI) fetchOnce();
      }
    });
    return () => { cancelled = true; ac.abort(); unsub(); };
  }, [fetchOnce, autoUI]);

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <HomeBar className="sticky top-0 z-30 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur" />
      <div className="mx-auto max-w-[2200px] p-6 space-y-6">
        <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Matrices</h1>
            <p className="text-sm text-slate-400">USDT bridge + preview rings · {coins.length} coins</p>
            <p className="text-xs text-slate-400">
              Metronome <span className="font-mono">{Math.round(baseMs/1000)}s</span>
              {data?.ts?.benchmark ? <> · ts <span className="font-mono">{prettyTs(data.ts.benchmark)}</span></> : null}
              {lastFetchAt ? <> · updated <span className="font-mono">{prettyTs(lastFetchAt)}</span></> : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-700">
              <input type="checkbox" checked={autoUI} onChange={(e) => setAutoUI(e.target.checked)} />
              UI auto
            </label>
            <button
              onClick={() => fetchOnce()}
              className="px-3 py-2 rounded-xl text-sm bg-emerald-400/90 text-black hover:brightness-95 disabled:opacity-60"
              disabled={loading}
            >
              {loading ? 'Fetching…' : 'Fetch'}
            </button>
          </div>
        </header>

        {/* matrices grid */}
        <section className="grid gap-6 grid-cols-1 md:grid-cols-2">
          {TYPES.map((t: TKey) => {
            const mat = data?.matrices?.[t] ?? null;
            const flags = (data?.flags as any)?.[t] as MatFlags | undefined;
            const ts = data?.ts?.[t] ?? null;
            return (
              <div key={t} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm text-slate-300 font-medium">{t}</div>
                  <div className="text-[11px] text-slate-400">ts: {prettyTs(ts ?? undefined)}</div>
                </div>
                <Matrix kind={t} coins={coins} values={mat as any} flags={flags} />
              </div>
            );
          })}
        </section>

        {err ? (
          <div className="rounded-lg border border-amber-700/50 bg-amber-950/30 text-amber-200 px-3 py-2 text-xs">
            {err}
          </div>
        ) : null}
      </div>
    </div>
  );
}
