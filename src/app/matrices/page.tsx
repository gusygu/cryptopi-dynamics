// src/app/dynamics/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NavBar from "@/components/NavBar";
import HomeBar from "@/components/HomeBar";
import { useSettings } from "@/lib/settings/provider";
import MeaAuxCard from "@/auxiliary/mea_aux/ui/MeaAuxCard";
import CinAuxPanel from "@/auxiliary/cin-aux/ui/CinAuxTable";
import { subscribe, getState, setEnabled } from "@/lib/pollerClient";

/* ---------- Types ---------- */
type TsKey = "benchmark" | "pct24h" | "delta" | "id_pct" | "pct_drv";
type Grid = (number | null)[][];
type FlagGrid = boolean[][];
type Flags = { frozen?: FlagGrid; bridged?: FlagGrid } | null;
type MatricesResp = {
  ok: boolean;
  coins: string[];
  ts?: Partial<Record<TsKey, number>>;
  matrices: Partial<Record<TsKey, Grid>>;
  flags?: Partial<Record<TsKey, Flags>>;
  _cache?: string;
};
type Disposition = "both" | "rows" | "cols";

/* ---------- Helpers ---------- */
const nullGrid = (n: number): Grid =>
  Array.from({ length: n }, () => Array(n).fill(null) as (number | null)[]);

const ensureGrid = (g: any, n: number): Grid =>
  Array.isArray(g) ? (g as Grid) : nullGrid(n);

const ensureFlag = (g: any, n: number): FlagGrid =>
  Array.isArray(g) ? (g as FlagGrid) : Array.from({ length: n }, () => Array(n).fill(false));

/** Display rules:
 *  - pct24h: given by Binance already scaled as percent (e.g. 0.9397), show "0.9397%"
 *  - id_pct: raw fraction (e.g. 0.00019657), show 6 decimals, no '%'
 *  - benchmark & Δ: 4 decimals
 *  - everything else: 6 decimals
 */
function fmtValue(title: string, v: number | null): string {
  if (v == null) return "—";
  if (/pct24h|%24h/i.test(title)) return `${Number(v).toFixed(4)}%`; // no extra ×100
  if (/id_pct/i.test(title)) return Number(v).toFixed(6);
  if (/benchmark|Δ|\bdelta\b/i.test(title)) return Number(v).toFixed(4);
  return Number(v).toFixed(6);
}

// precedence: purple (frozen) > grey (bridged) > yellow (===0) > green/red
function cellClasses({
  value, frozen, bridged,
}: { value: number | null; frozen?: boolean; bridged?: boolean }) {
  if (frozen) return "bg-violet-900/40 text-violet-200 border-violet-700/50";
  if (bridged) return "bg-slate-700/35 text-slate-200 border-slate-600/40";
  if (value == null) return "bg-slate-900/40 text-slate-500 border-slate-800/40";
  if (value === 0) return "bg-amber-900/30 text-amber-200 border-amber-700/40";

  const v = Number(value);
  const m = Math.abs(v);

  const pos = [
    "bg-emerald-900/20 text-emerald-200 border-emerald-800/25",
    "bg-emerald-900/35 text-emerald-200 border-emerald-800/40",
    "bg-emerald-900/55 text-emerald-100 border-emerald-800/60",
    "bg-emerald-900/75 text-emerald-100 border-emerald-800/80",
  ];
  const neg = [
    "bg-red-950/30 text-red-200 border-red-900/40",
    "bg-red-900/45 text-red-200 border-red-800/55",
    "bg-red-900/65 text-red-100 border-red-800/75",
    "bg-red-900/85 text-red-100 border-red-800/90",
  ];

  const idx = m < 0.0005 ? 0 : m < 0.002 ? 1 : m < 0.01 ? 2 : 3;
  return v > 0 ? pos[idx] : neg[idx];
}

function ValuePill({
  title, v, frozen, bridged,
}: { title: string; v: number | null; frozen?: boolean; bridged?: boolean }) {
  return (
    <span
      className={[
        "inline-flex min-w-[80px] items-center justify-center rounded-lg",
        "px-1.5 py-0.5 font-mono tabular-nums text-[11px] border shadow-inner",
        cellClasses({ value: v, frozen, bridged }),
      ].join(" ")}
      title={v == null ? "—" : String(v)}
    >
      {fmtValue(title, v)}
    </span>
  );
}

/* -------------------------------- PAGE -------------------------------- */

export default function MatricesPage() {
  const { settings } = useSettings();

  const [baseMs, setBaseMs] = useState<number>(() => Math.max(1000, getState().dur40 * 1000));
  const secondaryEnabled = !!settings.timing?.secondaryEnabled;
  const secondaryCycles = Math.max(1, Math.min(10, Number(settings.timing?.secondaryCycles ?? 3)));

  const universe = useMemo<string[]>(
    () => (settings.coinUniverse?.length ? settings.coinUniverse : []),
    [settings.coinUniverse]
  );
  const clusters = settings.clustering?.clusters ?? [{ id: "cl-1", name: "Cluster 1", coins: [] }];

  const [applyClustering] = useState(true);
  const [clusterIdx, setClusterIdx] = useState(0);
  const [disposition] = useState<Disposition>("both");

  const [data, setData] = useState<MatricesResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [running, setRunning] = useState<boolean>(() => getState().enabled);
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);
  const [lastDataTs, setLastDataTs] = useState<number | null>(null);
  const [tMinus, setTMinus] = useState<number>(baseMs);

  const coinsFromCluster = useMemo(
    () => (clusters[clusterIdx]?.coins ?? []).filter((c) => universe.includes(c)),
    [clusters, clusterIdx, universe]
  );

  // === unified coin list for auxiliary cards: prefer cluster, fallback to universe ===
  const coinsForAux = useMemo(() => {
    const arr = (applyClustering && disposition === "both" && coinsFromCluster.length >= 2)
      ? coinsFromCluster
      : universe;
    return arr;
  }, [applyClustering, disposition, coinsFromCluster, universe]);

  // === matrices fetch ===
  const coinsForFetch: string[] = useMemo(() => {
    if (applyClustering && disposition === "both" && coinsFromCluster.length) return coinsFromCluster;
    return universe;
  }, [applyClustering, disposition, coinsFromCluster, universe]);

  const abortRef = useRef<AbortController | null>(null);

  const fetchLatest = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      setLoading(true);
      setErr(null);
      setLastFetchAt(Date.now());

      const url = new URL("/api/matrices/latest", window.location.origin);
      if (coinsForFetch.length) url.searchParams.set("coins", coinsForFetch.join(","));
      url.searchParams.set("t", String(Date.now()));
      const r = await fetch(url, { cache: "no-store", signal: ac.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as MatricesResp;
      if (!j?.ok) throw new Error("payload not ok");
      setData(j);
      const ts = Object.values(j.ts || {}).filter((x): x is number => typeof x === "number");
      setLastDataTs(ts.length ? Math.max(...ts) : Date.now());
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setErr(String(e?.message || e));
        setData(null);
      }
    } finally {
      setLoading(false);
      setTMinus(baseMs);
    }
  }, [coinsForFetch, baseMs]);

  // Subscribe to global poller for sync refresh + countdown
  useEffect(() => {
    let cycle = 0;
    const unsub = subscribe((ev) => {
      if (ev.type === "state") {
        setRunning(ev.state.enabled);
        setBaseMs(Math.max(1000, ev.state.dur40 * 1000));
        setTMinus(ev.state.remaining40 * 1000);
      } else if (ev.type === "tick") {
        setTMinus(ev.remaining40 * 1000);
      } else if (ev.type === "tick40" || ev.type === "refresh") {
        if (running) fetchLatest();
        if (running && secondaryEnabled) {
          cycle = (cycle + 1) % Math.max(1, secondaryCycles);
          if (cycle === 0) fetchLatest();
        }
      }
    });
    return () => { unsub(); };
  }, [fetchLatest, running, secondaryEnabled, secondaryCycles]);

  useEffect(() => {
    if (clusterIdx >= clusters.length) setClusterIdx(0);
  }, [clusters.length, clusterIdx]);

  const coins = data?.coins ?? [];
  const mats  = data?.matrices || {};
  const fl    = data?.flags || {};

  const since = (ms: number) => `${Math.max(0, Math.round(ms / 1000))}s`;
  const sinceFetch = lastFetchAt ? since(Date.now() - lastFetchAt) : "—";
  const sinceData  = lastDataTs ? since(Date.now() - lastDataTs) : "—";

  // strictly separate pct24h from id_pct
  const gBenchmark: Grid = ensureGrid(mats.benchmark, coins.length);
  const gPct24h:    Grid = ensureGrid(mats.pct24h, coins.length); // no fallback
  const gDelta:     Grid = ensureGrid(mats.delta, coins.length);
  const gIdPct:     Grid = ensureGrid(mats.id_pct, coins.length);
  const gPctDrv:    Grid = ensureGrid(mats.pct_drv, coins.length);

  const fBenchBr:     FlagGrid = ensureFlag(fl?.benchmark?.bridged, coins.length);
  const fPctBr:       FlagGrid = ensureFlag(fl?.pct24h?.bridged, coins.length);
  const fPctFrozen:   FlagGrid = ensureFlag(fl?.pct24h?.frozen,  coins.length);
  const fBenchFrozen: FlagGrid = ensureFlag(fl?.benchmark?.frozen, coins.length);
  const fDeltaFrozen: FlagGrid = ensureFlag(fl?.delta?.frozen,     coins.length);
  const fDrvFrozen:   FlagGrid = ensureFlag(fl?.pct_drv?.frozen,   coins.length);

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <HomeBar className="sticky top-0 z-30 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur" />
      <NavBar />
      <div className="mx-auto max-w-[1800px] p-4 lg:p-6 space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl lg:text-3xl font-semibold">Dynamics — Matrices</h1>
            <p className="text-xs text-slate-400">
              Green = positive · Red = negative · Yellow = 0.000 · Purple = frozen · Grey = bridged (no direct market)
            </p>
            <p className="text-xs text-slate-500 flex gap-3 flex-wrap">
              <span>Metronome: <span className="font-mono">{Math.round(baseMs/1000)}s</span></span>
              <span>Chronometer: last fetch <span className="font-mono">{sinceFetch}</span> · last data <span className="font-mono">{sinceData}</span></span>
              <span>Next tick in <span className="font-mono">{Math.max(0, Math.round(tMinus/1000))}s</span></span>
              <span>Poller: <span className={`font-mono ${running ? "text-emerald-300" : "text-rose-300"}`}>{running ? "running" : "stopped"}</span></span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setEnabled(!running)} className={`rounded-xl px-3 py-2 text-xs border ${running ? "border-rose-700/50 hover:bg-rose-900/30" : "border-emerald-700/50 hover:bg-emerald-900/30"}`}>{running ? "Stop" : "Start"} poller</button>
            <button onClick={() => fetchLatest()} className="rounded-xl border border-slate-800 px-3 py-2 text-sm hover:bg-slate-800">Refresh</button>
          </div>
        </header>

        {data ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 auto-rows-[minmax(480px,auto)]">
            <MatrixCard title="benchmark (A/B)" coins={coins} grid={gBenchmark} bridged={fBenchBr}   frozen={fBenchFrozen} />
            <MatrixCard title="pct24h (A/B)"    coins={coins} grid={gPct24h}   bridged={fPctBr}     frozen={fPctFrozen} />
            <MatrixCard title="Δ (A/B)"         coins={coins} grid={gDelta}    frozen={fDeltaFrozen} />
            <MatrixCard title="id_pct"          coins={coins} grid={gIdPct}    bridged={fPctBr}     frozen={fPctFrozen} />
            <MatrixCard title="pct_drv"         coins={coins} grid={gPctDrv}   frozen={fDrvFrozen} />
            
            {/* MEA-AUX */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-0 min-h-[480px] overflow-hidden">
              <div className="p-5 h-full">
                <MeaAuxCard
                  key={`mea-${coinsForAux.join("-")}-${baseMs}`}
                  coins={coinsForAux}
                  defaultK={Number((settings.params?.values as any)?.k ?? 7)}
                  autoRefreshMs={baseMs}
                />
              </div>
            </div>

            {/* CIN-AUX */}
            <div className="md:col-span-2">
              <CinAuxPanel
                key={`cin-${coinsForAux.join("-")}-${baseMs}`}
                title="CIN-AUX"
                clusterCoins={coinsForAux}
              />
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-slate-400">
            {err ? `Error: ${err}` : "Loading matrices…"}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Matrix card ---------- */
function MatrixCard({
  title, coins, grid, frozen, bridged,
}: {
  title: string;
  coins: string[];
  grid: Grid;
  frozen?: FlagGrid;
  bridged?: FlagGrid;
}) {
  const safeGrid: Grid = ensureGrid(grid, coins.length);
  const Fz: FlagGrid = frozen ?? ensureFlag(undefined, coins.length);
  const Br: FlagGrid = bridged ?? ensureFlag(undefined, coins.length);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 min-h-[480px]">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-300">{title}</div>
      </div>
      <div className="overflow-auto">
        <table className="min-w-max text-[11px]">
          <thead>
            <tr>
              <th className="w-10"></th>
              {coins.map((c) => (
                <th key={c} className="px-1.5 py-1 text-right text-slate-400 font-mono tabular-nums">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {safeGrid.map((row: (number | null)[], i: number) => (
              <tr key={i}>
                <th className="pr-2 py-1 text-right text-slate-400 font-mono tabular-nums">{coins[i]}</th>
                {row.map((v: number | null, j: number) => (
                  <td key={`${i}-${j}`} className="px-0.5 py-0.5">
                    {i === j ? (
                      <div className="w-[80px] h-[22px] rounded-lg bg-slate-800/60 border border-slate-700/40" />
                    ) : (
                      <ValuePill title={title} v={v} frozen={Fz?.[i]?.[j]} bridged={Br?.[i]?.[j]} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
