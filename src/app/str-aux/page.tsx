'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Histogram from '@/app/str-aux/Histogram';
import CoinPanel from '@/app/str-aux/CoinPanel';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

type FM = {
  gfm?: number; // legacy ratio form (not used directly here)
  sigma: number;
  zAbs: number;
  vInner: number;
  vOuter: number;
  inertia: number;
  disruption: number;
  nuclei?: { binIndex: number }[];
};

type Hist = {
  edges: number[];
  counts: number[];
  probs: number[];
  muR: number;
  stdR: number;
  sigmaGlobal: number;
};

type CoinOut = {
  ok: boolean;
  n?: number;
  window?: string;
  bins?: number;
  opening?: number;
  fm?: FM & {
    gfm_ref_price?: number;   // GFMr
    gfm_calc_price?: number;  // GFMc
    gfm_price?: number;       // legacy fallback
  };
  // NEW: cards for opening + live
  cards?: {
    opening?: { benchmark?: number; pct24h?: number };
    live?: { benchmark?: number; pct24h?: number; pct_drv?: number };
  };
  hist?: Hist;
  error?: string;
  [k: string]: any;
};

type BinsResponse = {
  ok: boolean;
  ts: number;
  symbols: string[];
  out: Record<string, CoinOut>;
};

const DEFAULT_COINS = (process.env.NEXT_PUBLIC_COINS ?? 'BTC ETH SOL ADA BNB XRP').toUpperCase();
const PAGE_SIZE = 4;
const REFRESH_MS = 40_000; // 40s

function useBins(coins: string, windowSel: '30m' | '1h' | '3h', auto: boolean) {
  const [data, setData] = useState<BinsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchOnce = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const url = `/api/str-aux/bins?coins=${encodeURIComponent(coins)}&window=${windowSel}&bins=128&sessionId=ui`;
      const r = await fetch(url, { cache: 'no-store' });
      const j = (await r.json()) as BinsResponse;
      if (!r.ok || !j.ok) throw new Error((j as any)?.error ?? `HTTP ${r.status}`);
      setData(j);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [coins, windowSel]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (cancelled) return;
      await fetchOnce();
    };

    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }

    // kick once
    run();

    if (auto) {
      timer.current = setInterval(run, REFRESH_MS);
    }

    return () => {
      cancelled = true;
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [fetchOnce, auto]);

  return { data, loading, err, refetch: fetchOnce };
}

function prettyTs(ts?: number) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export default function StrAuxPage() {
  const [coins, setCoins] = useState(DEFAULT_COINS);
  const [windowSel, setWindowSel] = useState<'30m' | '1h' | '3h'>('30m');
  const [auto, setAuto] = useState(true);
  const [page, setPage] = useState(0);

  const { data, loading, err, refetch } = useBins(coins, windowSel, auto);

  const symbols = useMemo(() => {
    if (data?.symbols?.length) return data.symbols;
    // derive from input if API hasn't answered yet (supports commas OR spaces)
    return coins
      .split(/[,\s]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)
      .map(s => (s.endsWith('USDT') ? s : `${s}USDT`));
  }, [data, coins]);

  const pageCount = Math.max(1, Math.ceil(symbols.length / PAGE_SIZE));
  const pageClamped = Math.min(page, pageCount - 1);
  const visible = symbols.slice(pageClamped * PAGE_SIZE, pageClamped * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    // reset to first page when coin set changes
    setPage(0);
  }, [coins]);

  return (
    <main className={`${inter.variable} theme-lab font-sans min-h-screen bg-[var(--bg)] text-[var(--text)]`}>
      <div className="mx-auto max-w-[1400px] p-6 space-y-6">
        {/* Top bar */}
        <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Lab · Multi Dash</h1>
            <p className="text-sm text-[var(--muted)]">
              Live STR-Aux (IDHR 128) · windowed klines · four panels per page
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              className="px-3 py-2 text-sm rounded-xl outline-none bg-[var(--panel-2)] border border-[var(--border)] placeholder:text-[var(--muted)]"
              value={coins}
              onChange={e => setCoins(e.target.value.toUpperCase())}
              placeholder="BTC ETH SOL ADA"
            />
            <select
              className="px-3 py-2 text-sm rounded-xl bg-[var(--panel-2)] border border-[var(--border)]"
              value={windowSel}
              onChange={e => setWindowSel(e.target.value as any)}
            >
              <option value="30m">30m</option>
              <option value="1h">1h</option>
              <option value="3h">3h</option>
            </select>
            <label className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-[var(--panel-2)] border border-[var(--border)]">
              <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />
              auto 40s
            </label>
            <button
              onClick={refetch}
              className="px-3 py-2 rounded-xl text-sm bg-[var(--accent-2)] text-black hover:brightness-95"
              disabled={loading}
            >
              {loading ? 'Fetching…' : 'Fetch'}
            </button>
          </div>
        </header>

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <div className="text-xs text-[var(--muted)]">
            ts: {prettyTs(data?.ts)} · window: {windowSel} · coins: {coins}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={pageClamped === 0}
              className="px-2 py-1 rounded-lg bg-[var(--panel-2)] border border-[var(--border)] disabled:opacity-50"
            >
              ◀
            </button>
            <span className="text-sm tabular-nums">
              {pageClamped + 1}/{pageCount}
            </span>
            <button
              onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
              disabled={pageClamped >= pageCount - 1}
              className="px-2 py-1 rounded-lg bg-[var(--panel-2)] border border-[var(--border)] disabled:opacity-50"
            >
              ▶
            </button>
          </div>
        </div>

        {/* Error */}
        {err && (
          <div className="rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">{err}</div>
        )}

        {/* 2×2 grid of panels */}
        <section className="grid gap-5 md:grid-cols-2">
          {visible.map(sym => {
            const co = data?.out?.[sym] as CoinOut | undefined;
            return (
              <CoinPanel
                key={sym}
                symbol={sym}
                coin={co}
                histogram={
                  <Histogram
                    counts={co?.hist?.counts ?? []}
                    height={70}
                    nuclei={(co?.fm?.nuclei ?? []).map(n => n.binIndex)}
                  />
                }
              />
            );
          })}
        </section>
      </div>
    </main>
  );
}
