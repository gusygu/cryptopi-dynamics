'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import HomeBar from '@/components/HomeBar';
import Histogram from '@/app/str-aux/Histogram';
import CoinPanel from '@/app/str-aux/CoinPanel';
import { useSettings } from '@/lib/settings/provider';
import { subscribe, getState } from '@/lib/pollerClient';

type WindowSel = '30m' | '1h' | '3h';

type PairAvailability = {
  usdt: string[];     // server-verified USDT-quoted
  all: string[];      // server-verified ALL quotes (USDT + cross + fiat supported by preview)
  // (optional) route may also send availableBuckets; we don’t need it here
};

type FM = {
  gfm_ref_price?: number;   // GFMr (anchor)
  gfm_calc_price?: number;  // GFMc (live)
  sigma?: number; zAbs?: number; vInner?: number; vOuter?: number;
  inertia?: number; disruption?: number;
  nuclei?: { binIndex: number }[];
};
type Hist = { counts: number[] };
type CoinOut = {
  ok: boolean;
  n?: number;
  window?: string;
  bins?: number;
  cards?: {
    opening?: { benchmark?: number; pct24h?: number };
    live?: { benchmark?: number; pct24h?: number; pct_drv?: number };
  };
  fm?: FM;
  hist?: Hist;
  error?: string;
  overlay?: {
    shift_stamp?: boolean;
    shift_n?: number;
    shift_hms?: string;
    swap_n?: number;
    swap_sign?: 'ascending' | 'descending' | null;
    swap_hms?: string;
  };
  gfmDelta?: { absPct?: number; anchorPrice?: number | null; price?: number | null };
  streams?: {
    benchmark?: { prev: number; cur: number; greatest: number };
    pct24h?:    { prev: number; cur: number; greatest: number };
    pct_drv?:   { prev: number; cur: number; greatest: number };
  };
  sessionStats?: { priceMin: number; priceMax: number; benchPctMin: number; benchPctMax: number };
  meta?: { uiEpoch?: number };
  lastUpdateTs?: number;
};
type BinsResponse = {
  ok: boolean;
  ts: number;
  symbols: string[];                        // processed symbols this tick
  out: Record<string, CoinOut>;
  available?: PairAvailability;             // verified availability
  selected?: string[];                      // server’s chosen selection (subset of available)
  timing?: { autoRefreshMs?: number; secondaryEnabled?: boolean; secondaryCycles?: number };
  window?: WindowSel;
};

const uniqUpper = (xs: string[]) => {
  const s = new Set<string>(), out: string[] = [];
  for (const x of xs || []) {
    const u = String(x || '').trim().toUpperCase();
    if (!u || s.has(u)) continue;
    s.add(u);
    out.push(u);
  }
  return out;
};
const isUsdt = (sym: string) => /USDT$/.test(sym);

function prettyTs(ts?: number) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

export default function StrAuxPage() {
  const { settings } = useSettings();

  // metronome/poller timing
  const [baseMs, setBaseMs] = useState<number>(() => Math.max(1000, getState().dur40 * 1000));
  const secondaryEnabled = !!settings.timing?.secondaryEnabled;
  const secondaryCycles = Math.max(1, Math.min(10, Number(settings.timing?.secondaryCycles ?? 3)));

  // Settings coin universe (display + coins= param)
  const bases = useMemo(
    () => uniqUpper(settings.coinUniverse?.length ? settings.coinUniverse : ['BTC','ETH','BNB','SOL','ADA','DOGE','USDT','PEPE','BRL']),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.coinUniverse]
  );
  const [pickedCoins, setPickedCoins] = useState<string[]>(bases);
  useEffect(() => { setPickedCoins(bases); }, [bases.join(',')]);
  const toggleCoin = (c: string) =>
    setPickedCoins(prev => prev.includes(c) ? prev.filter(x => x !== c) : uniqUpper([...prev, c]));

  const [windowSel, setWindowSel] = useState<WindowSel>('30m');
  const [auto, setAuto] = useState(true);
  const [page, setPage] = useState(0);

  // server-verified availability
  const [available, setAvailable] = useState<PairAvailability>({ usdt: [], all: [] });

  // user selection (symbols)
  const [pairs, setPairs] = useState<string[]>([]);

  // data + ui state
  const [data, setData] = useState<BinsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hideNoData, setHideNoData] = useState(true);

  // Fetch bins route (server drives availability; we pass coins= for preview filtering)
  const fetchOnce = useCallback(async (opts?: { signal?: AbortSignal }) => {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams();
      // Always pass coins= so the server availability mirrors the picker
      const coins = pickedCoins.length ? pickedCoins : bases;
      if (coins.length) qs.set('coins', coins.join(','));
      if (pairs.length) qs.set('pairs', pairs.join(','));
      qs.set('window', windowSel);
      qs.set('bins', '128');
      qs.set('sessionId', 'ui');

      const r = await fetch(`/api/str-aux/bins?${qs.toString()}`, { cache: 'no-store', signal: opts?.signal });
      const j = (await r.json()) as BinsResponse;
      if (!r.ok || !j?.ok) throw new Error((j as any)?.error ?? `HTTP ${r.status}`);

      setData(j);

      // Update availability from server (verified)
      if (j.available) {
        const nextAvail: PairAvailability = {
          usdt: Array.isArray(j.available.usdt) ? uniqUpper(j.available.usdt) : [],
          all:  Array.isArray(j.available.all)  ? uniqUpper(j.available.all)  : [],
        };
        setAvailable(nextAvail);

        // Seed pairs on first successful fetch OR if current pairs are outside availability
        if (!pairs.length) {
          if (j.selected?.length) setPairs(uniqUpper(j.selected));
          else if (nextAvail.usdt.length) setPairs(nextAvail.usdt);
          else if (nextAvail.all.length) setPairs(nextAvail.all.slice(0, 6)); // small start
        } else {
          // prune any pairs that fell out of availability
          const allowed = new Set(nextAvail.all);
          setPairs(prev => prev.filter(p => allowed.has(p)));
        }
      }

      // Optionally remove tiles that returned ok:false
      if (hideNoData && j.symbols?.length) {
        const okSet = new Set(j.symbols.filter(s => j.out?.[s]?.ok));
        setPairs(prev => prev.filter(p => okSet.has(p)));
      }
    } catch (e: any) {
      const name = e?.name ?? '';
      const msg = e?.message ?? String(e ?? '');
      if (name === 'AbortError' || /aborted/i.test(msg)) return;
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }, [pairs, windowSel, pickedCoins, bases, hideNoData]);

  // Poller
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    const run = async () => { if (!cancelled) await fetchOnce({ signal: ac.signal }); };
    run();

    let cycle = 0;
    const unsub = subscribe((ev) => {
      if (ev.type === 'state') {
        setBaseMs(Math.max(1000, ev.state.dur40 * 1000));
      } else if ((ev.type === 'tick40' || ev.type === 'refresh') && auto) {
        run();
        if (secondaryEnabled) {
          cycle = (cycle + 1) % Math.max(1, secondaryCycles);
          if (cycle === 0) run();
        }
      }
    });
    return () => { cancelled = true; ac.abort(); unsub(); };
  }, [fetchOnce, auto, secondaryEnabled, secondaryCycles]);

  // Symbols to render (optionally hide “no data”)
  const symbolsAll = useMemo(() => (data?.symbols?.length ? data.symbols : pairs), [data?.symbols, pairs]);
  const symbols = useMemo(() => {
    if (!hideNoData) return symbolsAll;
    const out: string[] = [];
    for (const s of symbolsAll) {
      const ok = data?.out?.[s]?.ok;
      if (ok === undefined) out.push(s);
      else if (ok) out.push(s);
    }
    return out;
  }, [symbolsAll, data?.out, hideNoData]);

  // Pagination (3 columns × 2 rows)
  const PAGE_SIZE = 6;
  const pageCount = Math.max(1, Math.ceil(symbols.length / PAGE_SIZE));
  const pageClamped = Math.min(page, pageCount - 1);
  const visible = symbols.slice(pageClamped * PAGE_SIZE, pageClamped * PAGE_SIZE + PAGE_SIZE);
  useEffect(() => { setPage(0); }, [pairs.join(','), hideNoData]);

  // Dropdown options = server-verified availability minus currently selected
  const addOptions = useMemo(() => {
    const setSel = new Set(pairs);
    const usdtOpts = available.usdt.filter(s => !setSel.has(s));
    const nonUsdt = available.all.filter(s => !isUsdt(s) && !setSel.has(s));
    // USDT first, then others
    return [...usdtOpts, ...nonUsdt];
  }, [available.usdt, available.all, pairs]);

  // helpers
  const addPair = (s: string) => setPairs(p => uniqUpper([...(p ?? []), s]));
  const removePair = (s: string) => setPairs(p => (p ?? []).filter(x => x !== s));
  const resetUsdt = () => setPairs(available.usdt);

  /* -------------------------------- UI -------------------------------- */

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <HomeBar className="sticky top-0 z-30 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur" />
      <div className="mx-auto max-w-[1800px] p-6 space-y-6">
        <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">STR-AUX — Multi Dash</h1>
            <p className="text-sm text-slate-400">
              Live IDHR(128) · orderbook + klines · {bases.length} coins in Settings
            </p>
            <p className="text-xs text-slate-400">
              Metronome <span className="font-mono">{Math.round(baseMs/1000)}s</span>
              {secondaryEnabled ? <> · secondary every <span className="font-mono">{secondaryCycles}</span> cycles</> : null}
              {data?.ts ? <> · ts <span className="font-mono">{prettyTs(data.ts)}</span></> : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="px-3 py-2 text-sm rounded-xl bg-slate-900/60 border border-slate-700"
              value={windowSel}
              onChange={e => setWindowSel(e.target.value as WindowSel)}
              title="Window"
            >
              <option value="30m">30m</option>
              <option value="1h">1h</option>
              <option value="3h">3h</option>
            </select>
            <label className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-700">
              <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />
              auto
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

        {/* coin selector drives coins= param */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="text-sm text-slate-400 mb-2">Coins</div>
          <div className="flex flex-wrap gap-2">
            {bases.map((c) => {
              const on = pickedCoins.includes(c);
              return (
                <button
                  key={c}
                  onClick={() => toggleCoin(c)}
                  className={[
                    "px-2 py-1 rounded-lg text-sm border",
                    on
                      ? "bg-emerald-900/40 border-emerald-700/50 text-emerald-100"
                      : "bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800",
                  ].join(" ")}
                >
                  {c}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Selected: <span className="font-mono">{pickedCoins.filter(c => c!=='USDT').join(', ') || '—'}</span>
          </p>
        </section>

        {/* pair picker */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-400">Pairs</span>

            {/* selected */}
            <div className="flex flex-wrap gap-2">
              {pairs.map((s) => (
                <span key={s} className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-slate-800/70 border border-slate-700 text-sm">
                  <span className="font-mono">{s}</span>
                  <button className="opacity-70 hover:opacity-100" onClick={() => removePair(s)} title="Remove">×</button>
                </span>
              ))}
              {!pairs.length && <span className="text-sm text-slate-500">none selected</span>}
            </div>

            <div className="ml-auto flex items-center gap-2">
              {/* server-verified only; toggle removed to avoid leftovers */}
              <select
                className="px-2 py-1 text-sm rounded-lg bg-slate-800/70 border border-slate-700 min-w-[280px]"
                onChange={(e) => { const v = e.target.value; if (v) { addPair(v); e.currentTarget.selectedIndex = 0; } }}
                value=""
                title="Add pair (server-verified)"
              >
                <option value="" disabled>Add pair…</option>
                {addOptions.map((s) => (
                  <option key={s} value={s}>{s}{isUsdt(s) ? ' · USDT' : ' · cross/fiat'}</option>
                ))}
              </select>

              <button
                className="px-2 py-1 rounded-lg text-sm bg-slate-800/70 border border-slate-700 hover:bg-slate-800"
                onClick={resetUsdt}
                title="Reset to USDT legs"
                disabled={!available.usdt.length}
              >
                Reset USDT
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-400">
            Options (server-verified): <span className="font-mono">{available.usdt.length}</span> USDT,&nbsp;
            <span className="font-mono">{Math.max(0, available.all.length - available.usdt.length)}</span> cross/fiat
          </p>
        </section>

        {/* error */}
        {err && (
          <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-200">
            {err}
          </div>
        )}

        {/* panels */}
        <section className="grid gap-5 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((sym) => {
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

        {/* pagination */}
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-400">
            ts: {prettyTs(data?.ts)} · window: {windowSel} · pairs: {pairs.length}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={pageClamped === 0}
              className="px-2 py-1 rounded-lg bg-slate-900/60 border border-slate-700 disabled:opacity-50"
            >
              ◀
            </button>
            <span className="text-sm tabular-nums">{pageClamped + 1}/{pageCount}</span>
            <button
              onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
              disabled={pageClamped >= pageCount - 1}
              className="px-2 py-1 rounded-lg bg-slate-900/60 border border-slate-700 disabled:opacity-50"
            >
              ▶
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
