'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NavBar from '@/components/NavBar';
import Histogram from '@/app/str-aux/Histogram';
import CoinPanel from '@/app/str-aux/CoinPanel';
import { useSettings } from '@/lib/settings/provider';

type WindowSel = '30m' | '1h' | '3h';
type PairAvailability = { usdt: string[]; cross: string[]; all: string[] };

type FM = {
  gfm?: number; sigma?: number; zAbs?: number; vInner?: number; vOuter?: number;
  inertia?: number; disruption?: number; nuclei?: { binIndex: number }[];
  gfm_ref_price?: number; gfm_calc_price?: number;
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
};
type BinsResponse = {
  ok: boolean;
  ts: number;
  symbols: string[];
  out: Record<string, CoinOut>;
  available?: PairAvailability;
  selected?: string[];
  timing?: { autoRefreshMs?: number; secondaryEnabled?: boolean; secondaryCycles?: number };
};

/* ---------------- utils ---------------- */

const uniqUpper = (xs: string[]) => {
  const s = new Set<string>(), out: string[] = [];
  for (const x of xs) {
    const u = String(x || '').trim().toUpperCase();
    if (!u || s.has(u)) continue;
    s.add(u);
    out.push(u);
  }
  return out;
};

const usdtLegsFromCoins = (coins: string[]) =>
  uniqUpper(coins.filter(c => c !== 'USDT').map(c => `${c}USDT`));

const crossPairsFromCoins = (coins: string[]) => {
  const cs = uniqUpper(coins).filter(c => c !== 'USDT');
  const out: string[] = [];
  for (let i = 0; i < cs.length; i++) {
    for (let j = 0; j < cs.length; j++) {
      if (i === j) continue;
      out.push(`${cs[i]}${cs[j]}`);
    }
  }
  return uniqUpper(out);
};

// Verify a list of symbols using Binance preview (batching)
async function verifyPreview(symbols: string[], chunk = 180): Promise<Set<string>> {
  const ok = new Set<string>();
  for (let i = 0; i < symbols.length; i += chunk) {
    const batch = symbols.slice(i, i + chunk);
    const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(batch))}`;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) continue;
      const arr = (await r.json()) as Array<{ symbol?: string }>;
      for (const t of arr ?? []) if (t?.symbol) ok.add(String(t.symbol).toUpperCase());
    } catch {
      // ignore this batch; we’ll still keep USDT legs
    }
  }
  return ok;
}

function prettyTs(ts?: number) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

/* ---------------- page ---------------- */

export default function StrAuxPage() {
  const { settings } = useSettings();

  // timing
  const baseMs = Math.max(1000, Number(settings.timing?.autoRefreshMs ?? 40_000));
  const secondaryEnabled = !!settings.timing?.secondaryEnabled;
  const secondaryCycles = Math.max(1, Math.min(10, Number(settings.timing?.secondaryCycles ?? 3)));

  // universe from Settings
  const bases = useMemo(
    () => uniqUpper(settings.coinUniverse?.length ? settings.coinUniverse : ['BTC','ETH','BNB','SOL','ADA','XRP','DOGE','USDT']),
    [settings.coinUniverse]
  );

  // coin selector
  const [pickedCoins, setPickedCoins] = useState<string[]>(bases);
  useEffect(() => { setPickedCoins(bases); }, [bases.join(',')]);
  const toggleCoin = (c: string) =>
    setPickedCoins(prev => prev.includes(c) ? prev.filter(x => x !== c) : uniqUpper([...prev, c]));

  const [windowSel, setWindowSel] = useState<WindowSel>('30m');
  const [auto, setAuto] = useState(true);
  const [page, setPage] = useState(0);

  // availability (from API) + client preview
  const [availableApi, setAvailableApi] = useState<PairAvailability>({ usdt: [], cross: [], all: [] });
  const [availableUi, setAvailableUi] = useState<PairAvailability>({ usdt: [], cross: [], all: [] });

  // selected pairs (symbols)
  const [pairs, setPairs] = useState<string[]>([]);

  // bins response
  const [data, setData] = useState<BinsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Build UI-side availability from picked coins
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const coins = pickedCoins.length ? pickedCoins : bases;
      const usdt = usdtLegsFromCoins(coins);
      const crossCand = crossPairsFromCoins(coins);
      const verified = await verifyPreview(crossCand);
      if (cancelled) return;
      const cross = crossCand.filter(s => verified.has(s));
      const all = uniqUpper([...usdt, ...cross]);
      setAvailableUi({ usdt, cross, all });
      // If nothing selected yet, seed with USDT legs
      if (!pairs.length && usdt.length) setPairs(usdt);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedCoins.join(','), bases.join(',')]);

  // Merge API + UI availability
  const availableUX = useMemo(() => {
    const usdt = availableApi.usdt.length ? availableApi.usdt : availableUi.usdt;
    const cross = uniqUpper([...(availableApi.cross ?? []), ...(availableUi.cross ?? [])]);
    const all = uniqUpper([...(availableApi.all ?? []), ...usdt, ...cross]);
    return { usdt, cross, all } as PairAvailability;
  }, [availableApi, availableUi]);

  // prune pairs that fell out of availability
  useEffect(() => {
    if (!pairs.length) return;
    const allowed = new Set(availableUX.all);
    setPairs(prev => prev.filter(p => allowed.has(p)));
  }, [availableUX.all.join(','), pairs.length]);

  // fetch bins route (now uses pairs= symbols)
  const fetchOnce = useCallback(async (opts?: { signal?: AbortSignal }) => {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams();
      if (pairs.length) qs.set('pairs', pairs.join(',')); // ⬅️ symbols path
      qs.set('window', windowSel);
      qs.set('bins', '128');
      qs.set('sessionId', 'ui');

      const r = await fetch(`/api/str-aux/bins?${qs.toString()}`, { cache: 'no-store', signal: opts?.signal });
      const j = (await r.json()) as BinsResponse;
      if (!r.ok || !j?.ok) throw new Error((j as any)?.error ?? `HTTP ${r.status}`);

      setData(j);

      // hydrate API availability if provided
      if (j.available) {
        setAvailableApi({
          usdt: Array.isArray(j.available.usdt) ? j.available.usdt : [],
          cross: Array.isArray(j.available.cross) ? j.available.cross : [],
          all: Array.isArray(j.available.all) ? j.available.all : [],
        });
      }

      // If nothing selected yet and server proposes a selection, accept it
      if (!pairs.length && j.selected?.length) setPairs(j.selected);
    } catch (e: any) {
      const name = e?.name ?? '';
      const msg = e?.message ?? String(e ?? '');
      if (name === 'AbortError' || /aborted/i.test(msg)) return;
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }, [pairs, windowSel]);

  // poller
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();

    const run = async () => { if (!cancelled) await fetchOnce({ signal: ac.signal }); };
    run();

    if (timer.current) clearInterval(timer.current);
    if (auto) {
      timer.current = setInterval(run, baseMs);
      if (secondaryEnabled) {
        let n = 0;
        const sec = setInterval(() => { n++; if (n % secondaryCycles === 0) run(); }, baseMs);
        return () => { clearInterval(sec); cancelled = true; ac.abort(); if (timer.current) clearInterval(timer.current); };
      }
    }
    return () => { cancelled = true; ac.abort(); if (timer.current) clearInterval(timer.current); };
  }, [fetchOnce, auto, baseMs, secondaryEnabled, secondaryCycles]);

  // pagination
  const symbols = useMemo(() => (data?.symbols?.length ? data.symbols : pairs), [data?.symbols, pairs]);
  const PAGE_SIZE = 4;
  const pageCount = Math.max(1, Math.ceil(symbols.length / PAGE_SIZE));
  const pageClamped = Math.min(page, pageCount - 1);
  const visible = symbols.slice(pageClamped * PAGE_SIZE, pageClamped * PAGE_SIZE + PAGE_SIZE);
  useEffect(() => { setPage(0); }, [pairs.join(',')]);

  // helpers
  const addPair = (s: string) => setPairs(p => uniqUpper([...(p ?? []), s]));
  const removePair = (s: string) => setPairs(p => (p ?? []).filter(x => x !== s));
  const resetUsdt = () => setPairs(availableUX.usdt);

  /* ---------------- UI ---------------- */

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <NavBar />
      <div className="mx-auto max-w-[1600px] p-6 space-y-6">
        <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">STR-AUX — Multi Dash</h1>
            <p className="text-sm text-slate-400">Live IDHR(128) · orderbook + klines · {bases.length} coins in Settings</p>
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

        {/* coin selector */}
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
              <select
                className="px-2 py-1 text-sm rounded-lg bg-slate-800/70 border border-slate-700 min-w-[260px]"
                onChange={(e) => { const v = e.target.value; if (v) { addPair(v); e.currentTarget.selectedIndex = 0; } }}
                value=""
                title="Add pair"
              >
                <option value="" disabled>Add pair…</option>
                {/* USDT legs first */}
                {availableUX.usdt.filter(s => !pairs.includes(s)).map((s) => (
                  <option key={s} value={s}>{s} · USDT</option>
                ))}
                {/* Verified cross */}
                {availableUX.cross.filter(s => !pairs.includes(s)).map((s) => (
                  <option key={s} value={s}>{s} · cross</option>
                ))}
              </select>

              <button
                className="px-2 py-1 rounded-lg text-sm bg-slate-800/70 border border-slate-700 hover:bg-slate-800"
                onClick={resetUsdt}
                title="Reset to USDT legs"
                disabled={!availableUX.usdt.length}
              >
                Reset USDT
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-400">
            Options from selection: <span className="font-mono">{availableUX.usdt.length}</span> USDT,&nbsp;
            <span className="font-mono">{availableUX.cross.length}</span> cross
          </p>
        </section>

        {/* error */}
        {err && (
          <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-200">
            {err}
          </div>
        )}

        {/* panels */}
        <section className="grid gap-5 md:grid-cols-2">
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
