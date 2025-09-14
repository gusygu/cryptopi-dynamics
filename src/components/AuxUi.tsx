// src/components/AuxUi.tsx
"use client";

import React, { useMemo, useState } from "react";
import {
  useMeaGrid,
  useStrAux,
  usePreviewSymbols,
  useDomainVM,
  type Grid,
} from "@/lib/dynamicsClient";

type Props = {
  coins: string[];
  base: string;   // selected in page
  quote: string;  // selected in page
  onSelectPair?: (b: string, q: string) => void;
  className?: string;
  k?: number;     // MEA k (optional)
};

export default function AuxUi({ coins, base, quote, onSelectPair, className = "", k }: Props) {
  const C = useMemo(() => coins.map(U), [coins]);
  const B = U(base);
  const Q = U(quote);

  // Converter VM (DB-sourced summary for MEA + STR)
  const { vm: convVm } = useDomainVM(B, Q, C, []);

  /* ───────── MEA grid → single pair value + tiering */
  const { grid, loading: meaLoading, error: meaErr, refresh: refreshMea } = useMeaGrid(C, { k });
  const mea = useMemo(() => {
    if (!grid?.length) return { value: null as number | null, weight: null as number | null, tier: "-" };
    const i = C.indexOf(B), j = C.indexOf(Q);
    if (i < 0 || j < 0 || i === j) return { value: null, weight: null, tier: "-" };

    const v = numOrNull(grid?.[i]?.[j]);
    // build list of |values| for off-diagonal cells to compute percentile weight
    const mags: number[] = [];
    for (let r = 0; r < C.length; r++) {
      for (let c = 0; c < C.length; c++) {
        if (r === c) continue;
        const vv = numOrNull(grid?.[r]?.[c]);
        if (vv != null) mags.push(Math.abs(vv));
      }
    }
    // Prefer DB-provided MEA weight/tier from converter VM when available
    const vmMea = (convVm as any)?.panels?.mea ?? (convVm as any)?.metricsPanel?.mea;
    const weight = numOrNull(vmMea?.value) ?? tierWeightFrom(v, mags);
    const tierName = String(vmMea?.tier ?? tierNameFrom(v, weight));
    return { value: v, weight, tier: tierName };
  }, [grid, B, Q, C, convVm]);

  /* ───────── STR metrics (kept) */
  const { symbols: previewSyms } = usePreviewSymbols(C);
  const symAB = `${B}${Q}`, symBA = `${Q}${B}`;
  const hasAB = previewSyms.includes(symAB);
  const hasBA = previewSyms.includes(symBA);

  const fetchSel = hasAB ? { b: B, q: Q, sym: symAB }
                : hasBA ? { b: Q, q: B, sym: symBA }
                :          { b: B, q: Q, sym: symAB };

  const [forceUnverified, setForceUnverified] = useState(!hasAB && !hasBA);
  const allowUnverified = (!hasAB && !hasBA) ? forceUnverified : false;
  const previewOK = hasAB || hasBA || allowUnverified;

  // Prefer DB VM for STR; disable bins fetch when we have DB data
  const vmStr = (convVm as any)?.panels?.str ?? (convVm as any)?.metricsPanel?.str;
  const haveDbStr = vmStr && (vmStr.gfm != null || vmStr.shift != null || vmStr.vTendency != null);

  const { summary: str, loading: strLoading, error: strErr, refresh: refreshStr } =
    haveDbStr
      ? // call disabled variant: (symbol, enabled=false) to avoid flinching fetch
        useStrAux(fetchSel.sym, false)
      : useStrAux(fetchSel.b, fetchSel.q, {
          window: "30m",
          bins: 128,
          sessionId: "dyn",
          allowUnverified,
        });

  // Merge DB VM STR summary if available (fallback to bins fields)
  const strMerged = useMemo(() => {
    const gfmAbsPctDbField = numOrNull((vmStr as any)?.gfmAbsPct);
    const gfmAbsPctFromShift = numOrNull(vmStr?.shift) != null ? Math.abs(Number(vmStr!.shift)) * 100 : null;
    return {
      gfmAbsPct: gfmAbsPctDbField ?? gfmAbsPctFromShift ?? str?.gfmAbsPct,
      vTendency: numOrNull(vmStr?.vTendency) ?? str?.vTendency,
      shifts: numOrNull((vmStr as any)?.shifts) ?? str?.shifts,
      swaps: numOrNull((vmStr as any)?.swaps) ?? str?.swaps,
      ts: str?.ts,
    } as { gfmAbsPct?: number | null; vTendency?: number | null; shifts?: number | null; swaps?: number | null; ts?: number | null };
  }, [vmStr, str]);

  /* ───────── UI */
  return (
    <section className={["rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-4", className].join(" ")}>
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-200">Auxiliaries</span>
          <PairPicker coins={C} base={B} quote={Q} onChange={onSelectPair} />
          <Chip label={`MEA k ${k ?? "auto"}`} />
          <span className={[
              "inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-[11px]",
              previewOK ? "border-emerald-800/50 bg-emerald-950/30 text-emerald-200"
                        : "border-slate-700/60 bg-slate-900/60 text-slate-300",
            ].join(" ")}>
            <span className="opacity-70">symbol</span>
            <code className="font-mono">{`${B}${Q}`}</code>
            {(!hasAB && !hasBA) && (
              <button
                className="ml-1 rounded border border-slate-600/60 px-1.5 py-0.5 hover:bg-slate-800/60"
                onClick={() => setForceUnverified(v => !v)}
                title="Fetch even if symbol isn't in preview list"
              >
                {allowUnverified ? "preview on" : "preview off"}
              </button>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refreshMea} className="rounded-lg border border-slate-700/60 px-3 py-1.5 text-sm hover:bg-slate-800/60">Refresh MEA</button>
          <button onClick={refreshStr} className="rounded-lg border border-slate-700/60 px-3 py-1.5 text-sm hover:bg-slate-800/60">Refresh STR</button>
        </div>
      </div>

      {/* MEA — single pair */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs text-slate-400">MEA — {B}/{Q}</div>
          {meaLoading && <span className="text-[11px] text-slate-400">loading…</span>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Metric title="Measure (MEA)" value={fmt6(mea.value)} tone={toneFromNum(mea.value)} />
          <Metric title="Tier weight"    value={fmt3(mea.weight)} tone="neutral" />
          <Metric title="Tier"           value={String(mea.tier)} tone={tierTone(mea.tier)} />
        </div>
        {meaErr && <div className="mt-2 text-[11px] text-amber-300/90">MEA notice: {meaErr}</div>}
      </div>

      {/* STR mini metrics */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs text-slate-400">
            STR — {B}/{Q}
            <span className={[
              "ml-2 px-1.5 py-0.5 rounded border text-[10px]",
              previewOK ? "border-emerald-800/50 text-emerald-200"
                        : "border-slate-700/60 text-slate-300",
            ].join(" ")}>
              {previewOK ? "preview ok" : "preview unavailable"}
            </span>
            {str?.ts ? (
              <span className="ml-3 text-[10px] opacity-70">
                updated {timeAgo(str.ts)}
              </span>
            ) : null}
          </div>
          {strLoading && <span className="text-[11px] text-slate-400">loading…</span>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Metric title="GFM Δ%" value={fmtPct(strMerged?.gfmAbsPct)} tone={toneFromNum(strMerged?.gfmAbsPct)} />
          <Metric title="vTendency"     value={fmt6(strMerged?.vTendency)}  tone={toneFromNum(strMerged?.vTendency)} />
          <Metric title="Shifts"         value={fmtInt(strMerged?.shifts)}   tone="neutral" />
          <Metric title="Swaps"          value={fmtInt(strMerged?.swaps)}    tone="neutral" />
        </div>

        {strErr && <div className="mt-2 text-[11px] text-amber-300/90">STR notice: {strErr}</div>}
      </div>
    </section>
  );
}

/* ───────────────── subcomponents & helpers ───────────────── */

function PairPicker({ coins, base, quote, onChange }:{
  coins:string[]; base:string; quote:string; onChange?:(b:string,q:string)=>void
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <select className="rounded-md bg-slate-900 border border-slate-700/60 px-2 py-1 text-xs"
        value={base} onChange={(e)=>onChange?.(e.target.value.toUpperCase(), quote)}>
        {coins.map(c=><option key={`b-${c}`} value={c}>{c}</option>)}
      </select>
      <span className="text-slate-500 text-xs">/</span>
      <select className="rounded-md bg-slate-900 border border-slate-700/60 px-2 py-1 text-xs"
        value={quote} onChange={(e)=>onChange?.(base, e.target.value.toUpperCase())}>
        {coins.map(c=><option key={`q-${c}`} value={c}>{c}</option>)}
      </select>
    </div>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-lg border border-slate-700/60 bg-slate-900/60 px-2 py-0.5 text-[11px] text-slate-300">
      {label}
    </span>
  );
}

function Metric({ title, value, tone = "neutral" }:{
  title:string; value:string; tone?:"neutral"|"pos"|"neg"|"amber"
}) {
  const map = {
    neutral: "border-slate-700/60 bg-slate-900/60 text-slate-200",
    pos:     "border-emerald-700/60 bg-emerald-950/30 text-emerald-200",
    neg:     "border-rose-700/60 bg-rose-950/30 text-rose-200",
    amber:   "border-amber-700/60 bg-amber-950/30 text-amber-200",
  } as const;
  return (
    <div className={["rounded-lg border px-3 py-2", map[tone]].join(" ")}>
      <div className="text-[11px] text-slate-400">{title}</div>
      <div className="mt-0.5 font-mono tabular-nums">{value}</div>
    </div>
  );
}

/* ───────── tiering logic ───────── */

function tierWeightFrom(v: number | null, mags: number[]): number | null {
  if (v == null || !Number.isFinite(v) || !mags.length) return null;
  const a = Math.abs(v);
  const sorted = mags.slice().sort((x, y) => x - y);
  const idx = sorted.findIndex((x) => a <= x);
  const rank = (idx === -1 ? sorted.length : idx) / sorted.length; // 0..1
  return clamp(rank, 0, 1);
}
function tierNameFrom(v: number | null, w: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v === 0) return "neutral";
  const p = Number.isFinite(w as any) ? (w as number) : 0.5;
  const bucket =
    p >= 0.90 ? "apex"
  : p >= 0.70 ? "high"
  : p >= 0.40 ? "mid"
  :              "low";
  return v > 0 ? `${bucket}+` : `${bucket}-`;
}
function tierTone(name: string): "neutral" | "pos" | "neg" | "amber" {
  if (name === "neutral" || name === "—") return "amber";
  return name.endsWith("+") ? "pos" : "neg";
}

/* ───────── misc helpers ───────── */

function U(s:string){ return String(s||"").trim().toUpperCase(); }
function numOrNull(x:any){ const n = Number(x); return Number.isFinite(n) ? n : null; }
function clamp(n:number, a:number, b:number){ return Math.min(b, Math.max(a, n)); }
function fmt6(v:any){ const n = Number(v); return Number.isFinite(n)? n.toFixed(6) : "—"; }
function fmt3(v:any){ const n = Number(v); return Number.isFinite(n)? n.toFixed(3) : "—"; }
function fmtPct(v:any){ const n = Number(v); return Number.isFinite(n)? n.toFixed(3) : "—"; }
function fmtInt(v:any){ const n = Number(v); return Number.isFinite(n)? String(Math.round(n)) : "—"; }
function toneFromNum(v:any):"neutral"|"pos"|"neg"|"amber"{
  const n = Number(v); if(!Number.isFinite(n)) return "neutral";
  if(n===0) return "amber"; return n>0 ? "pos":"neg";
}
function timeAgo(ts?: number | null){
  if(!ts) return "—";
  const s = Math.max(0, Math.round((Date.now() - ts)/1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s/60);
  return `${m}m ago`;
}

