'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import HomeBar from '@/components/HomeBar';
import Matrix from '@/components/Matrix';
import { useSettings } from '@/lib/settings/provider';
import { subscribe, getState } from '@/lib/pollerClient';

type TKey = 'benchmark' | 'delta' | 'pct24h' | 'id_pct' | 'pct_drv';

type MatFlags = {
  frozen: boolean[][];
  bridged: boolean[][];
  preview: number[][];
};
type MatPayload = {
  ok?: boolean;
  coins: string[];
  matrices: Record<TKey, (number | null)[][] | null>;
  flags:    Record<TKey, MatFlags | null>;
  ts:       Record<TKey, number | null>;
  prevTs:   Record<TKey, number | null>;
  meta?: Record<string, any>;
};

type AutoState = {
  running: boolean;
  coins: string[];
  intervalMs: number;
  nextAt: number | null;
  lastRanAt: number | null;
};

const TYPES: TKey[] = ['benchmark', 'delta', 'pct24h', 'id_pct', 'pct_drv'];
const prettyTs = (ts?: number | null) => (ts ? new Date(ts).toLocaleString() : '—');

export default function MatricesPage() {
  const { settings } = useSettings();

  const [baseMs, setBaseMs] = useState<number>(() => Math.max(1000, getState().dur40 * 1000));
  const [autoUI, setAutoUI] = useState(true);
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);

  const coins = useMemo(
    () => (settings.coinUniverse?.length
      ? settings.coinUniverse.map(s => String(s).toUpperCase())
      : ['BTC','ETH','BNB','SOL','ADA','XRP','PEPE','USDT']),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.coinUniverse]
  );

  const [data, setData] = useState<MatPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ---- pipeline auto state (server) ----
  const [autoServer, setAutoServer] = useState<AutoState | null>(null);
  const [mutatingServer, setMutatingServer] = useState(false);

  const refreshAutoState = useCallback(async () => {
    try {
      const r = await fetch('/api/pipeline/auto', { cache: 'no-store' });
      if (!r.ok) throw new Error(`GET auto ${r.status}`);
      const j = await r.json();
      setAutoServer(j?.state ?? { running: false, coins: [], intervalMs: 0, nextAt: null, lastRanAt: null });
    } catch {
      // endpoint might not exist in dev; keep null
      setAutoServer(null);
    }
  }, []);

  const ensureServerAuto = useCallback(async () => {
    try {
      // if we cannot read state, skip silently
      const r0 = await fetch('/api/pipeline/auto', { cache: 'no-store' });
      if (!r0.ok) return;
      const s0 = await r0.json();
      if (!s0?.running && !s0?.state?.running) {
        // start with Settings' coins & timing and prime data
        await fetch('/api/pipeline/auto?immediate=1', { method: 'POST' });
      }
      await refreshAutoState();
    } catch {
      /* noop */
    }
  }, [refreshAutoState]);

  // ---- matrices fetch ----
  const fetchOnce = useCallback(async (opts?: { signal?: AbortSignal }) => {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams();
      if (coins?.length) qs.set('coins', coins.join(','));
      const r = await fetch(`/api/matrices/latest?${qs}`, { cache: 'no-store', signal: opts?.signal });
      const j = (await r.json()) as MatPayload;
      if (!r.ok || j?.ok === false) throw new Error((j as any)?.error ?? `HTTP ${r.status}`);
      setData(j);
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

  // initial bootstrap: ensure server auto is on, fetch once, hook into poller
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();

    (async () => {
      await ensureServerAuto();
      if (!cancelled) await fetchOnce({ signal: ac.signal });
    })();

    const unsub = subscribe((ev) => {
      if (ev.type === 'state') {
        setBaseMs(Math.max(1000, ev.state.dur40 * 1000));
      } else if (ev.type === 'tick40' || ev.type === 'refresh') {
        if (autoUI) fetchOnce();
      }
    });
    return () => { cancelled = true; ac.abort(); unsub(); };
  }, [ensureServerAuto, fetchOnce, autoUI]);

  // --- server auto controls ---
  const startServerAuto = useCallback(async () => {
    setMutatingServer(true);
    try {
      await fetch('/api/pipeline/auto?immediate=1', { method: 'POST' });
      await refreshAutoState();
    } finally {
      setMutatingServer(false);
    }
  }, [refreshAutoState]);

  const stopServerAuto = useCallback(async () => {
    setMutatingServer(true);
    try {
      await fetch('/api/pipeline/auto', { method: 'DELETE' });
      await refreshAutoState();
    } finally {
      setMutatingServer(false);
    }
  }, [refreshAutoState]);

  const seedOnce = useCallback(async () => {
    setMutatingServer(true);
    try {
      await fetch('/api/pipeline/run-once', { method: 'POST' });
      await fetchOnce();
      await refreshAutoState();
    } finally {
      setMutatingServer(false);
    }
  }, [fetchOnce, refreshAutoState]);

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
            {/* UI auto (client polling) */}
            <label className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-700">
              <input type="checkbox" checked={autoUI} onChange={e => setAutoUI(e.target.checked)} />
              UI auto
            </label>
            <button
              onClick={() => fetchOnce()}
              className="px-3 py-2 rounded-xl text-sm bg-emerald-400/90 text-black hover:brightness-95 disabled:opacity-60"
              disabled={loading}
            >
              {loading ? 'Fetching…' : 'Fetch'}
            </button>

            {/* Server auto (pipeline) */}
            <div className="ml-3 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-700">
              <span className="text-xs text-slate-400">Server auto:</span>
              <span className={`text-xs font-mono ${autoServer?.running ? 'text-emerald-400' : 'text-rose-400'}`}>
                {autoServer?.running ? 'running' : 'stopped'}
              </span>
              <button
                onClick={seedOnce}
                disabled={mutatingServer}
                className="ml-2 px-2 py-1 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 border border-slate-600"
                title="Run one pipeline cycle now"
              >
                Seed now
              </button>
              {autoServer?.running ? (
                <button
                  onClick={stopServerAuto}
                  disabled={mutatingServer}
                  className="px-2 py-1 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 border border-slate-600"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={startServerAuto}
                  disabled={mutatingServer}
                  className="px-2 py-1 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 border border-slate-600"
                >
                  Start
                </button>
              )}
            </div>
          </div>
        </header>

        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="text-sm text-slate-400 mb-2">Coins</div>
          <div className="text-xs text-slate-300 font-mono">{coins.join(', ')}</div>

          {/* legend */}
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-300">
            <span className="inline-flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-sm bg-emerald-500/30" /> positive (cell fill)
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-sm bg-rose-500/30" /> negative (cell fill)
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-sm bg-amber-400/30" /> ~0 (|x| &lt; 1e-8) (cell fill)
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-sm bg-violet-500/30" /> frozen (cell fill)
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-sm ring-2 ring-emerald-400/80" /> preview (outer ring)
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-sm ring-2 ring-rose-400/80" /> inverse only (outer ring)
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-sm ring-2 ring-slate-500/70" /> not in preview (outer ring)
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-sm ring-2 ring-slate-400/80" /> bridged (inner ring)
            </span>
          </div>
        </section>

        {/* two per row */}
        <section className="grid gap-6 grid-cols-1 md:grid-cols-2">
          {(['benchmark','delta','pct24h','id_pct','pct_drv'] as TKey[]).map((t) => {
            const mat = data?.matrices?.[t] ?? null;
            const flags = (data?.flags?.[t] ?? null) as MatFlags | null;
            const ts = data?.ts?.[t] ?? null;
            return (
              <div key={t} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm text-slate-300 font-medium">{t}</div>
                  <div className="text-[11px] text-slate-400">ts: {prettyTs(ts)}</div>
                </div>
                <Matrix
                  kind={t}
                  coins={coins}
                  values={mat}
                  flags={flags || undefined}
                />
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
