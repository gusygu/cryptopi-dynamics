// src/components/AuxUi.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSettings } from "@/lib/settings/provider";
import {
  useCoinsUniverse,
  useMeaGrid,
  usePreviewSymbols,
  useStrAux,
  // Re-exported converter helpers (available if/when you render VM widgets here)
  // useDomainVM,
} from "@/lib/dynamicsClient";
import type { Coins, Grid } from "@/lib/dynamics.contracts";

type Props = {
  /** Prefer passing the exact coin universe for MEA; falls back to settings/env */
  coins?: Coins;
  /** Initial BASE/QUOTE for STR-AUX mini metrics */
  base?: string;
  quote?: string;
  /** Optional: externally control selected pair */
  onSelectPair?: (base: string, quote: string) => void;
  /** Optional K for MEA (server currently uses settings/defaults) */
  k?: number;
};

export default function AuxUi({ coins: coinsProp, base, quote, onSelectPair }: Props) {
  /* ───────────────── settings + clustering ───────────────── */
  const { settings } = useSettings() as any;
  const universe = useCoinsUniverse();

  const clusters = (settings?.clustering?.clusters ??
    [{ id: "cl-1", name: "Cluster 1", coins: [] }]) as Array<{ id: string; name: string; coins: string[] }>;

  const [applyClustering] = useState<boolean>(true);
  const [clusterIdx, setClusterIdx] = useState<number>(0);

  // Coins shown in MEA (prefer cluster coins if available)
  const coinsForAux: Coins = useMemo(() => {
    const envCoins = (coinsProp && coinsProp.length ? coinsProp : universe).map((c) => c.toUpperCase());
    const clusterCoins = (clusters?.[clusterIdx]?.coins ?? []).map((c) => c.toUpperCase());
    const filtered = (applyClustering && clusterCoins.length >= 2)
      ? clusterCoins.filter((c) => envCoins.includes(c))
      : envCoins;
    // ensure unique, keep order of filtered
    const seen = new Set<string>(), out: string[] = [];
    for (const c of filtered) if (!seen.has(c)) { seen.add(c); out.push(c); }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinsProp?.join("|"), universe.join("|"), applyClustering, clusterIdx, JSON.stringify(clusters)]);

  useEffect(() => {
    if (clusterIdx >= clusters.length) setClusterIdx(0);
  }, [clusterIdx, clusters.length]);

  /* ───────────────── selection (BASE/QUOTE) ───────────────── */
  const [selected, setSelected] = useState<{ base: string; quote: string }>(() => {
    const b = (base || coinsForAux[0] || "BTC").toUpperCase();
    const q = (quote || coinsForAux.find((c) => c !== b) || "USDT").toUpperCase();
    return { base: b, quote: q };
  });

  // reconcile when input or coins change
  useEffect(() => {
    const b = (base || selected.base || coinsForAux[0] || "BTC").toUpperCase();
    let q = (quote || selected.quote || coinsForAux.find((c) => c !== b) || "USDT").toUpperCase();
    if (b === q) {
      const alt = coinsForAux.find((c) => c !== b);
      if (alt) q = alt;
    }
    setSelected((old) => (old.base === b && old.quote === q ? old : { base: b, quote: q }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, quote, coinsForAux.join("|")]);

  const setPair = (b: string, q: string) => {
    const B = b.toUpperCase(), Q = q.toUpperCase();
    if (B === Q) return;
    setSelected({ base: B, quote: Q });
    onSelectPair?.(B, Q);
  };

  /* ───────────────── MEA grid ───────────────── */
  const { grid: rawMea, loading: meaLoading, error: meaErr, refresh: refreshMea } = useMeaGrid(coinsForAux);

  // Accept either number[][] or { weights:number[][] }
  const meaGrid: Grid | undefined = useMemo(() => {
    if (!rawMea) return undefined;
    const anyGrid: any = rawMea as any;
    if (Array.isArray(anyGrid)) return anyGrid as Grid;
    if (anyGrid && Array.isArray(anyGrid.weights)) return anyGrid.weights as Grid;
    return undefined;
  }, [rawMea]);

  /* ───────────────── preview + STR-AUX ───────────────── */
  const { symbols: previewSymbols } = usePreviewSymbols();
  const sym = `${selected.base}${selected.quote}`.toUpperCase();
  const previewOK = useMemo(() => previewSymbols.includes(sym), [previewSymbols, sym]);

  const { metrics: str, loading: strLoading, refresh: refreshStr } = useStrAux(sym, true);

  // vmKey: if you render VM widgets here, bump key to remount after pair/STR refresh
  const [vmKey, setVmKey] = useState(0);
  useEffect(() => {
    setVmKey((k) => k + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym]);
  const bumpVm = () => setVmKey((k) => k + 1);

  /* ───────────────── UI ───────────────── */
  return (
    <section className="w-full space-y-6">
      {/* Header controls (cluster + pair quick picker) */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <div className="inline-flex items-center gap-2">
          <label className="text-slate-400">Cluster</label>
          <select
            value={clusterIdx}
            onChange={(e) => setClusterIdx(Number(e.target.value) || 0)}
            className="rounded-md border border-slate-700 bg-slate-900/70 px-2 py-1 text-slate-200"
            title="Choose cluster for MEA universe"
          >
            {clusters.map((cl, i) => (
              <option key={cl.id || i} value={i}>{cl.name || `Cluster ${i + 1}`}</option>
            ))}
          </select>
        </div>

        <div className="inline-flex items-center gap-2 ml-3">
          <label className="text-slate-400">Pair</label>
          <select
            value={selected.base}
            onChange={(e) => setPair(e.target.value, selected.quote)}
            className="rounded-md border border-slate-700 bg-slate-900/70 px-2 py-1 text-slate-200"
            title="Base"
          >
            {coinsForAux.map((c) => <option key={`b-${c}`} value={c}>{c}</option>)}
          </select>
          <span className="text-slate-500">/</span>
          <select
            value={selected.quote}
            onChange={(e) => setPair(selected.base, e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-900/70 px-2 py-1 text-slate-200"
            title="Quote"
          >
            {coinsForAux.filter((c) => c !== selected.base).map((c) => (
              <option key={`q-${c}`} value={c}>{c}</option>
            ))}
          </select>

          <span
            className={[
              "ml-2 inline-flex items-center gap-2 rounded-xl border px-2.5 py-1",
              previewOK
                ? "border-emerald-700/60 text-emerald-200 bg-emerald-950/30 ring-1 ring-emerald-800/40"
                : "border-rose-700/60 text-rose-200 bg-rose-950/30 ring-1 ring-rose-800/40",
            ].join(" ")}
            title={previewOK ? "Preview market available" : "No direct preview market"}
          >
            {sym} <span className="opacity-70">{previewOK ? "• preview OK" : "• preview off"}</span>
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => { refreshMea(); }}
            className="rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800/60"
          >
            Refresh MEA
          </button>
          <button
            onClick={() => { refreshStr(); bumpVm(); }}
            className="rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800/60"
          >
            Refresh STR
          </button>
        </div>
      </div>

      {/* MEA grid */}
      <MeaCard
        coins={coinsForAux}
        grid={meaGrid}
        loading={meaLoading}
        error={meaErr}
        onRefresh={refreshMea}
      />

      {/* STR mini metrics for selected pair */}
      <StrMiniCard
        symbol={sym}
        previewOK={previewOK}
        loading={strLoading}
        gfmAbsPct={str?.gfmAbsPct ?? 0}
        vTendency={str?.vTendency ?? 0}
        shifts={str?.shifts ?? 0}
        swaps={str?.swaps ?? 0}
        ts={str?.ts ?? null}
        vmKey={vmKey}
      />

      {/* If/when you add VM widgets: render them here keyed by vmKey */}
      {/* <VMWidgets key={vmKey} base={selected.base} quote={selected.quote} /> */}
    </section>
  );
}

/* ------------------------------- MEA CARD ------------------------------- */

function MeaCard({
  coins,
  grid,
  loading,
  error,
  onRefresh,
}: {
  coins: Coins;
  grid?: Grid;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm shadow-lg">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold text-slate-200">MEA — Measure Matrix</h3>
          <p className="text-[11px] text-slate-400">Amber = 0.000 · Green &gt; 0 · Red &lt; 0 · 6-decimals</p>
        </div>
        <button
          onClick={onRefresh}
          className="rounded-lg border border-slate-700/70 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800/60"
          title="Refresh MEA"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="px-4 pb-4 text-slate-400 text-sm">Loading MEA…</div>
      ) : error ? (
        <div className="px-4 pb-4 text-rose-300 text-sm">MEA error: {error}</div>
      ) : !grid || !coins.length ? (
        <div className="px-4 pb-4 text-slate-400 text-sm">No MEA data.</div>
      ) : (
        <div className="px-4 pb-4 overflow-auto">
          <table className="min-w-max text-[11px]">
            <thead>
              <tr>
                <th className="w-10"></th>
                {coins.map((c) => (
                  <th key={`h-${c}`} className="px-1.5 py-1 text-right text-slate-400 font-mono tabular-nums">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((row, i) => (
                <tr key={`r-${i}`}>
                  <th className="pr-2 py-1 text-right text-slate-400 font-mono tabular-nums">{coins[i]}</th>
                  {row.map((v, j) => (
                    <td key={`c-${i}-${j}`} className="px-0.5 py-0.5">
                      {i === j ? (
                        <div className="w-[80px] h-[22px] rounded-lg bg-slate-800/60 border border-slate-700/40" />
                      ) : (
                        <MeaPill value={v} />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MeaPill({ value }: { value: number | null }) {
  const { cls, txt } = useMemo(() => {
    if (value == null) return { cls: "bg-slate-900/40 text-slate-500 border-slate-800/40", txt: "—" };
    if (value === 0)   return { cls: "bg-amber-900/30 text-amber-200 border-amber-700/40", txt: "0.000000" };

    const v = Number(value);
    const m = Math.abs(v);
    const idx = m < 0.0005 ? 0 : m < 0.002 ? 1 : m < 0.01 ? 2 : 3;

    const pos = [
      "bg-emerald-900/20 text-emerald-200 border-emerald-800/25",
      "bg-emerald-900/35 text-emerald-200 border-emerald-800/40",
      "bg-emerald-900/55 text-emerald-100 border-emerald-800/60",
      "bg-emerald-900/75 text-emerald-100 border-emerald-800/80",
    ];
    const neg = [
      "bg-rose-950/30 text-rose-200 border-rose-900/40",
      "bg-rose-900/45 text-rose-200 border-rose-800/55",
      "bg-rose-900/65 text-rose-100 border-rose-800/75",
      "bg-rose-900/85 text-rose-100 border-rose-800/90",
    ];

    return { cls: v > 0 ? pos[idx] : neg[idx], txt: v.toFixed(6) };
  }, [value]);

  return (
    <span
      className={[
        "inline-flex min-w-[86px] items-center justify-center rounded-lg",
        "px-1.5 py-0.5 font-mono tabular-nums text-[11px] border shadow-inner",
        cls,
      ].join(" ")}
      title={value == null ? "—" : String(value)}
    >
      {txt}
    </span>
  );
}

/* ----------------------------- STR MINI CARD ----------------------------- */

function StrMiniCard({
  symbol,
  previewOK,
  loading,
  gfmAbsPct,
  vTendency,
  shifts,
  swaps,
  ts,
  vmKey,
}: {
  symbol: string;
  previewOK: boolean;
  loading: boolean;
  gfmAbsPct: number;
  vTendency: number;
  shifts: number;
  swaps: number;
  ts: number | null;
  vmKey: number;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm shadow-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className={[
              "inline-flex items-center gap-2 rounded-xl border px-2.5 py-1 text-xs font-medium",
              previewOK
                ? "border-emerald-700/60 text-emerald-200 bg-emerald-950/30 ring-1 ring-emerald-800/40"
                : "border-rose-700/60 text-rose-200 bg-rose-950/30 ring-1 ring-rose-800/40",
            ].join(" ")}
            title={previewOK ? "Preview market available" : "No direct preview market"}
          >
            {symbol}
            <span className="opacity-70">{previewOK ? "• preview OK" : "• preview off"}</span>
          </span>
          <span className="text-[11px] text-slate-500">vmKey: {vmKey}</span>
        </div>
        <div className="text-[11px] text-slate-400">
          {loading ? "loading…" : ts ? `updated ${Math.max(0, Math.round((Date.now() - ts) / 1000))}s ago` : "—"}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricChip label="GFM Δ abs %" value={gfmAbsPct} fmt="pct2" goodHigh />
        <MetricChip label="vTendency" value={vTendency} fmt="num6" goodHigh />
        <MetricChip label="Shifts" value={shifts} fmt="int" goodLow />
        <MetricChip label="Swaps" value={swaps} fmt="int" goodLow />
      </div>
    </div>
  );
}

function MetricChip({
  label,
  value,
  fmt,
  goodHigh,
  goodLow,
}: {
  label: string;
  value: number;
  fmt: "int" | "num6" | "pct2";
  goodHigh?: boolean;
  goodLow?: boolean;
}) {
  const { txt, cls } = useMemo(() => {
    let text = "";
    switch (fmt) {
      case "int": text = `${Math.round(Number(value) || 0)}`; break;
      case "num6": text = (Number(value) || 0).toFixed(6); break;
      case "pct2": text = (Number(value) || 0).toFixed(2) + "%"; break;
    }
    const v = Number(value) || 0;
    const pos = "bg-emerald-900/35 text-emerald-200 border-emerald-800/50";
    const neg = "bg-rose-900/45 text-rose-200 border-rose-800/60";
    const neu = "bg-slate-800/50 text-slate-200 border-slate-700/60";

    let color = neu;
    if (goodHigh) color = v >= 0 ? pos : neg;
    if (goodLow)  color = v <= 0 ? pos : neg;

    return { txt: text, cls: color };
  }, [value, fmt, goodHigh, goodLow]);

  return (
    <div className="rounded-xl border px-3 py-2 shadow-inner">
      <div className="text-[11px] text-slate-400 mb-0.5">{label}</div>
      <div className={["inline-flex min-w-[88px] items-center justify-center rounded-lg","px-2 py-1 font-mono tabular-nums text-[11px] border",cls].join(" ")}>
        {txt}
      </div>
    </div>
  );
}
