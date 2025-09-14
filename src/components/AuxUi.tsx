// src/components/AuxUI.tsx
"use client";

import { useMemo } from "react";
import { useMeaAux } from "@/lib/auxClient";
import { usePreviewSymbols, useStrAux } from "@/lib/dynamicsClient";

type StrPanel = { gfmDeltaPct?: number; vTendency?: number; shift?: number; swap?: number };
type CinRow = { coin: string; impSes?: number; lugSes?: number; impCyc?: number; lugCyc?: number };

const fmt6 = (x: any) => (Number.isFinite(Number(x)) ? Number(x).toFixed(6) : "—");
const fmt5 = (x: any) => (Number.isFinite(Number(x)) ? Number(x).toFixed(5) : "—");
const fmt0 = (x: any) => (Number.isFinite(Number(x)) ? Number(x).toFixed(0) : "—");

export default function AuxUI({
  coins,
  base,
  quote,
  className = "",
}: {
  coins: string[];
  base: string;
  quote: string;
  className?: string;
}) {
  // MEA grid (poller-aware)
  const { grid: meaGrid, loading: meaLoading } = useMeaGrid(coins);
  const i = coins.indexOf(base), j = coins.indexOf(quote);
  const meaValue = useMemo(() => (i >= 0 && j >= 0 ? Number(meaGrid?.[i]?.[j]) : undefined), [i, j, meaGrid]);

  // preview → STR enabled
  const { symbols: preview } = usePreviewSymbols();
  const sym = `${base}${quote}`.toUpperCase();
  const available = preview.includes(sym);

  // STR live metrics (only when in preview)
  const { metrics: str } = useStrAux(sym, available);

  const ring = available ? "ring-2 ring-emerald-500/50" : "ring-2 ring-rose-500/50";

  return (
    <div className={`rounded-xl border border-zinc-700/40 bg-zinc-900/60 p-3 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-zinc-100">Auxiliaries</div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="cp-chip">{base}/{quote}</span>
          <span className="cp-chip">preview:{available ? "YES" : "NO"}</span>
        </div>
      </div>

      {/* MEA */}
      <div className={`rounded-lg bg-zinc-900/70 border border-zinc-700/40 p-3 mb-3 ${ring}`}>
        <div className="text-xs text-zinc-400 mb-1">Measure (MEA)</div>
        <div className="font-mono text-[13px]">{meaLoading ? "…" : fmt6(meaValue, Math.abs(Number(meaValue) || 0) < 1e-3 ? 6 : 5)}</div>
      </div>

      {/* STR */}
      <div className="rounded-lg bg-zinc-900/70 border border-zinc-700/40 p-3">
        <div className="text-xs text-zinc-400 mb-2">Str-aux</div>
        {available ? (
          <div className="grid grid-cols-4 gap-2">
            <KV label="GFMΔ%"    v={str?.gfmAbsPct} dp={5} />
            <KV label="vTendency" v={str?.vTendency} dp={5} />
            <KV label="Shifts"   v={str?.shifts} dp={0} />
            <KV label="Swaps"    v={str?.swaps} dp={0} />
          </div>
        ) : (
          <div className="text-[12px] text-zinc-500">Pair not in preview — no live str-aux.</div>
        )}
      </div>
    </div>
  );
}

function KV({ label, v, dp }: { label: string; v: any; dp: number }) {
  const shown = Number.isFinite(Number(v)) ? Number(v).toFixed(dp) : "—";
  return (
    <div className="rounded-md bg-zinc-900/80 border border-zinc-700/40 p-2">
      <div className="text-[11px] text-zinc-400">{label}</div>
      <div className="font-mono text-[12px]">{shown}</div>
    </div>
  );
}