"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NavBar from "@/components/NavBar";
import { useSettings } from "@/lib/settings/provider";
import MeaAuxCard from "@/auxiliary/mea_aux/ui/MeaAuxCard";
import CinAuxPanel from "@/auxiliary/cin-aux/ui/CinAuxTable";

/* ---------- API payload types ---------- */
type TsKeys = "benchmark" | "delta" | "pct24h" | "id_pct" | "pct_drv";
type Flags = { frozen: boolean[][] } | null;
type MatricesResp = {
  ok: boolean;
  coins: string[];
  ts?: Partial<Record<TsKeys, number>>;
  matrices: Partial<Record<TsKeys, (number | null)[][]>>;
  flags?: Partial<Record<TsKeys, Flags>>;
  _cache?: string;
};

type Disposition = "both" | "rows" | "cols";

function fmtValue(title: string, v: number | null): string {
  if (v == null) return "—";
  // Accept both "pct24h" and "%24h"
  if (/(pct24h|%24h)/i.test(title)) return `${(Number(v) * 100).toFixed(2)}%`;
  return Number(v).toFixed(6);
}
function shadeIdx(v: number) {
  const m = Math.abs(v);
  if (m < 0.000001) return 0;
  if (m < 0.00001) return 1;
  if (m < 0.0001) return 2;
  if (m < 0.001) return 3;
  return 4;
}
function cellClasses(value: number | null, frozen?: boolean) {
  if (frozen) return "bg-violet-900/30 text-violet-200 border-violet-700/30";
  if (value == null) return "bg-slate-800/60 text-slate-400 border-slate-700/40";
  const nearZero = Math.abs(value) < 1e-8;
  if (nearZero) return "bg-amber-900/30 text-amber-200 border-amber-700/30";
  const idx = shadeIdx(value!);
  const pos = (value ?? 0) >= 0;
  const posScale = [
    "bg-emerald-900/25 text-emerald-200 border-emerald-700/20",
    "bg-emerald-900/35 text-emerald-200 border-emerald-700/30",
    "bg-emerald-900/45 text-emerald-200 border-emerald-700/40",
    "bg-emerald-900/55 text-emerald-200 border-emerald-700/50",
    "bg-emerald-900/65 text-emerald-100 border-emerald-700/60",
  ];
  const negScale = [
    "bg-rose-900/25 text-rose-200 border-rose-700/20",
    "bg-rose-900/35 text-rose-200 border-rose-700/30",
    "bg-rose-900/45 text-rose-200 border-rose-700/40",
    "bg-rose-900/55 text-rose-200 border-rose-700/50",
    "bg-rose-900/65 text-rose-100 border-rose-700/60",
  ];
  return (pos ? posScale : negScale)[idx];
}

// helpers
const nullGrid = (n: number) => Array.from({ length: n }, () => Array(n).fill(null) as (number | null)[]);
const ensureGrid = (g: any, n: number) => (Array.isArray(g) ? g : nullGrid(n));

function ValuePill({ title, v, frozen }: { title: string; v: number | null; frozen?: boolean }) {
  return (
    <span
      className={[
        "inline-flex min-w-[64px] items-center justify-center rounded-lg",
        "px-1.5 py-0.5 font-mono tabular-nums text-[11px] border shadow-inner",
        cellClasses(v, frozen),
      ].join(" ")}
      title={v == null ? "—" : String(v)}
    >
      {fmtValue(title, v)}
    </span>
  );
}

function Segmented({
  options, value, onChange, disabled,
}: {
  options: { key: string; label: string }[];
  value: string; onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <div className={`inline-flex rounded-lg border ${disabled ? "opacity-60" : ""} border-slate-800 overflow-hidden`}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.key)}
          className={`px-2 py-1 text-xs ${
            o.key === value ? "bg-slate-800 text-slate-100" : "bg-slate-900/60 text-slate-300 hover:bg-slate-800/60"
          } border-r border-slate-800 last:border-r-0`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------- PAGE -------------------------------- */

export default function MatricesPage() {
  const { settings } = useSettings();

  // timing (settings-driven)
  const baseMs = Math.max(1000, Number(settings.timing?.autoRefreshMs ?? 40_000));
  const secondaryEnabled = !!settings.timing?.secondaryEnabled;
  const secondaryCycles = Math.max(1, Math.min(10, Number(settings.timing?.secondaryCycles ?? 3)));

  // universe & clusters
  const universe = useMemo<string[]>(
    () => (settings.coinUniverse?.length ? settings.coinUniverse : []),
    [settings.coinUniverse]
  );
  const clusters = settings.clustering?.clusters ?? [{ id: "cl-1", name: "Cluster 1", coins: [] }];

  // clustering UI
  const [openCtl, setOpenCtl] = useState(false);
  const [applyClustering, setApplyClustering] = useState(true);
  const [clusterIdx, setClusterIdx] = useState(0);
  const [disposition, setDisposition] = useState<Disposition>("both");

  // data / state
  const [data, setData] = useState<MatricesResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // metronome / chronometer
  const [running, setRunning] = useState(true);
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);
  const [lastDataTs, setLastDataTs] = useState<number | null>(null);
  const [tMinus, setTMinus] = useState<number>(baseMs);

  const coinsFromCluster = useMemo(
    () => (clusters[clusterIdx]?.coins ?? []).filter((c) => universe.includes(c)),
    [clusters, clusterIdx, universe]
  );

  // ALWAYS pass coins: either clustered (both axes) or full universe.
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
      url.searchParams.set("t", String(Date.now())); // cache-buster
      if (coinsForFetch.length) url.searchParams.set("coins", coinsForFetch.join(","));
      const r = await fetch(url, { cache: "no-store", signal: ac.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as MatricesResp;
      if (!j?.ok) throw new Error("payload not ok");
      setData(j);
      const tsVals = Object.values(j.ts || {}).filter((x): x is number => typeof x === "number");
      setLastDataTs(tsVals.length ? Math.max(...tsVals) : Date.now());
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setErr(String(e?.message || e));
        setData(null);
      }
    } finally {
      setLoading(false);
      setTMinus(baseMs); // reset countdown
    }
  }, [coinsForFetch, baseMs]);

  // main metronome loop (start/stop)
  useEffect(() => {
    if (!running) return;
    fetchLatest();
    const id = setInterval(fetchLatest, baseMs);
    return () => clearInterval(id);
  }, [running, baseMs, fetchLatest]);

  // secondary loop (every N cycles)
  useEffect(() => {
    if (!running || !secondaryEnabled) return;
    let n = 0;
    const id = setInterval(() => {
      n++;
      if (n % secondaryCycles === 0) fetchLatest();
    }, baseMs);
    return () => clearInterval(id);
  }, [running, secondaryEnabled, secondaryCycles, baseMs, fetchLatest]);

  // countdown (t-minus) UI
  useEffect(() => {
    const id = setInterval(() => setTMinus((t) => (t > 1000 ? t - 1000 : 0)), 1000);
    return () => clearInterval(id);
  }, [baseMs]);

  // ensure clusterIdx is valid
  useEffect(() => {
    if (clusterIdx >= clusters.length) setClusterIdx(0);
  }, [clusters.length, clusterIdx]);

  const coins = data?.coins ?? [];
  const mats = data?.matrices || {};
  const flags = data?.flags || {};

  const runOnce = async () => {
    try {
      await fetch("/api/pipeline/run-once", { method: "POST", cache: "no-store" });
      setTimeout(fetchLatest, 500);
    } catch {}
  };

  const fmtMs = (ms: number) => `${Math.max(0, Math.round(ms / 1000))}s`;
  const sinceFetch = lastFetchAt ? `${fmtMs(Date.now() - lastFetchAt)}` : "—";
  const sinceData  = lastDataTs ? `${fmtMs(Date.now() - lastDataTs)}` : "—";

  // Safe grids (never undefined)
  const gBenchmark = ensureGrid(mats.benchmark, coins.length);
  const gPct24h    = ensureGrid(mats.pct24h ?? mats.id_pct, coins.length);
  const gDelta     = ensureGrid(mats.delta, coins.length);
  const gIdPct     = ensureGrid(mats.id_pct, coins.length);
  const gPctDrv    = ensureGrid(mats.pct_drv ?? mats.delta, coins.length);

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <NavBar />
      <div className="mx-auto max-w-screen-2xl p-4 lg:p-6 space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl lg:text-3xl font-semibold">Dynamics — Matrices</h1>
            <p className="text-xs text-slate-400">
              Green = positive, Red = negative, Yellow ≈ 0 · Purple = frozen (no change)
            </p>
            <p className="text-xs text-slate-500 flex gap-3 flex-wrap">
              <span>Metronome: <span className="font-mono">{fmtMs(baseMs)}</span>{secondaryEnabled ? <> · secondary every <span className="font-mono">{secondaryCycles}</span> cycles</> : null}</span>
              <span>Chronometer: last fetch <span className="font-mono">{sinceFetch}</span> · last data <span className="font-mono">{sinceData}</span></span>
              <span>Next tick in <span className="font-mono">{fmtMs(tMinus)}</span></span>
              <span>Poller: <span className={`font-mono ${running ? "text-emerald-300" : "text-rose-300"}`}>{running ? "running" : "stopped"}</span></span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setRunning((v) => !v)}
              className={`rounded-xl px-3 py-2 text-xs border ${running ? "border-rose-700/50 hover:bg-rose-900/30" : "border-emerald-700/50 hover:bg-emerald-900/30"}`}
              title="Start/stop metronome"
            >
              {running ? "Stop" : "Start"} poller
            </button>
            <button
              onClick={runOnce}
              className="rounded-xl bg-indigo-600/80 hover:bg-indigo-500 px-3 py-2 text-xs"
              title="Trigger one pipeline pass (dev)"
            >
              Force build (dev)
            </button>
            <button
              onClick={fetchLatest}
              className="rounded-xl border border-slate-800 px-3 py-2 text-sm hover:bg-slate-800"
            >
              Refresh
            </button>
          </div>
        </header>

        {/* clustering control */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setOpenCtl((v) => !v)}
              className="rounded-lg border border-slate-700/60 px-2 py-1 text-xs hover:bg-slate-800"
            >
              {openCtl ? "Hide clustering" : "Show clustering"}
            </button>
            <span className="text-xs text-slate-400">Universe: <span className="font-mono">{universe.length}</span> coins</span>
            <span className="ml-auto text-xs text-slate-500">
              {loading ? "Loading…" : err ? `Error: ${err}` : data ? `last gate ok (${data._cache ?? "miss"})` : "—"}
            </span>
          </div>

          {openCtl && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-blue-500"
                  checked={applyClustering}
                  onChange={(e) => setApplyClustering(e.target.checked)}
                />
                <span>Apply clustering</span>
              </label>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Cluster</span>
                <select
                  value={clusterIdx}
                  onChange={(e) => setClusterIdx(Number(e.target.value))}
                  className="rounded-lg bg-slate-900/60 border border-slate-800 px-2 py-1 text-sm"
                  disabled={!applyClustering}
                >
                  {clusters.map((c, i) => (
                    <option key={c.id ?? i} value={i}>
                      {c.name || `Cluster ${i + 1}`} ({c.coins.length})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Disposition</span>
                <Segmented
                  options={[
                    { key: "both", label: "Both axes" },
                    { key: "rows", label: "Rows only" },
                    { key: "cols", label: "Cols only" },
                  ]}
                  value={disposition}
                  onChange={(v) => setDisposition(v as Disposition)}
                  disabled={!applyClustering}
                />
              </div>
            </div>
          )}
        </div>

        {/* matrices + MEA card */}
        {data ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 auto-rows-[minmax(440px,auto)]">
              <MatrixCard title="benchmark (A/B)" coins={coins} grid={gBenchmark} frozen={flags?.benchmark?.frozen ?? undefined} />
              <MatrixCard title="pct24h (A/B)"       coins={coins} grid={gPct24h}   frozen={flags?.pct24h?.frozen ?? undefined} />
              <MatrixCard title="Δ (A/B)"            coins={coins} grid={gDelta}    frozen={flags?.delta?.frozen ?? undefined} />
              <MatrixCard title="id_pct"             coins={coins} grid={gIdPct}    frozen={flags?.id_pct?.frozen ?? undefined} />
              <MatrixCard title="pct_drv"            coins={coins} grid={gPctDrv}   frozen={flags?.pct_drv?.frozen ?? undefined} />
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-0 min-h-[440px]">
                <div className="p-5">
                  <MeaAuxCard
                    coins={coinsForFetch}
                    defaultK={Number((settings.params?.values as any)?.k ?? 7)}
                    autoRefreshMs={baseMs}
                  />
                </div>
              </div>
            </div>

            <div>
              <CinAuxPanel
                title="CIN-AUX"
                clusterCoins={coinsFromCluster}
                applyCluster={applyClustering && disposition === "both"}
              />
            </div>
          </>
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
  title, coins, grid, frozen,
}: {
  title: string; coins: string[]; grid: (number | null)[][]; frozen?: boolean[][];
}) {
  const safeGrid = ensureGrid(grid, coins.length);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 min-h-[440px]">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-300">{title}</div>
      </div>
      <div className="overflow-auto">
        <table className="min-w-max text-[11px]">
          <thead>
            <tr>
              <th className="w-10"></th>
              {coins.map((c) => (
                <th key={c} className="px-1.5 py-1 text-right text-slate-400 font-mono tabular-nums">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {safeGrid.map((row, i) => (
              <tr key={i}>
                <th className="pr-2 py-1 text-right text-slate-400 font-mono tabular-nums">{coins[i]}</th>
                {row.map((v, j) => (
                  <td key={`${i}-${j}`} className="px-0.5 py-0.5">
                    {i === j ? (
                      <div className="w-[64px] h-[22px] rounded-lg bg-slate-800/60 border border-slate-700/40" />
                    ) : (
                      <ValuePill title={title} v={v} frozen={frozen?.[i]?.[j]} />
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
