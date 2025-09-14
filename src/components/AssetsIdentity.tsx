"use client";

import { useMemo } from "react";
import type { AssetsIdentityProps, HistogramData, NumGrid } from "@/components/contracts";

const fmt4 = (x: any) => (Number.isFinite(Number(x)) ? Number(x).toFixed(4) : "—");
const fmt6 = (x: any) => (Number.isFinite(Number(x)) ? Number(x).toFixed(6) : "—");
const fmt3 = (x: any) => (Number.isFinite(Number(x)) ? Number(x).toFixed(3) : "0.000");
const fmtPct2 = (dec: any) =>
  Number.isFinite(Number(dec)) ? `${(Number(dec) * 100).toFixed(2)}%` : "—";

// -------- Mini SVG Histogram (inline) --------
function HistogramInline({ data }: { data: HistogramData }) {
  const edges = data?.edges || [];
  const counts = data?.counts || [];
  const label = data?.label ?? "pct_drv (%)";
  const nuclei = data?.nuclei ?? [];

  if (edges.length < 2 || counts.length < 1) {
    return (
      <div className="rounded-xl border border-zinc-700/40 bg-zinc-900/70 p-2">
        <div className="text-xs text-zinc-400">Histogram</div>
        <div className="text-xs text-zinc-500">—</div>
      </div>
    );
  }

  const vbW = 420, vbH = 140, pad = 28;
  const bins = counts.length;
  const xMin = edges[0], xMax = edges[edges.length - 1];
  const yMax = Math.max(...counts, 1);
  const xScale = (v: number) => pad + ((v - xMin) / Math.max(1e-12, xMax - xMin)) * (vbW - pad * 2);
  const yScale = (c: number) => (vbH - pad) - (c / yMax) * (vbH - pad * 2);

  // x ticks (5)
  const ticks = 5;
  const tickVals = Array.from({ length: ticks + 1 }, (_, k) => xMin + (k * (xMax - xMin)) / ticks);

  return (
    <div className="rounded-xl border border-zinc-700/40 bg-zinc-900/70 p-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs text-zinc-300">Histogram</div>
        <div className="text-[11px] text-zinc-400">{label}</div>
      </div>
      <svg viewBox={`0 0 ${vbW} ${vbH}`} className="w-full h-[160px] block">
        {/* axes */}
        <line x1={pad} y1={vbH - pad} x2={vbW - pad} y2={vbH - pad} stroke="rgb(110 110 120)" strokeWidth="1" />
        <line x1={pad} y1={pad}       x2={pad}        y2={vbH - pad}  stroke="rgb(110 110 120)" strokeWidth="1" />
        {/* x ticks */}
        {tickVals.map((t, i) => (
          <g key={`t${i}`}>
            <line x1={xScale(t)} y1={vbH - pad} x2={xScale(t)} y2={vbH - pad + 4} stroke="rgb(110 110 120)" strokeWidth="1" />
            <text x={xScale(t)} y={vbH - pad + 14} fontSize="10" textAnchor="middle" fill="rgb(180 180 190)">
              {Number.isFinite(t) ? t.toFixed(4) : ""}
            </text>
          </g>
        ))}
        {/* bars */}
        {counts.map((c, bi) => {
          const x0 = xScale(edges[bi]);
          const x1 = xScale(edges[bi + 1]);
          const w = Math.max(1, x1 - x0 - 1);
          const y = yScale(c);
          const h = (vbH - pad) - y;
          return (
            <rect
              key={`b${bi}`}
              x={x0 + 0.5}
              y={y}
              width={w}
              height={h}
              fill="rgba(16,185,129,0.35)"      // emerald-500/35
              stroke="rgba(16,185,129,0.45)"    // emerald-500/45
              strokeWidth="0.5"
              rx="2"
            />
          );
        })}
        {/* nuclei markers (optional) */}
        {nuclei.map((nv, i) => (
          <g key={`n${i}`}>
            <line x1={xScale(nv)} y1={pad} x2={xScale(nv)} y2={vbH - pad} stroke="rgba(99,102,241,0.45)" strokeDasharray="3,3" />
          </g>
        ))}
      </svg>
    </div>
  );
}

// -------- Main component: AssetsIdentity --------
export default function AssetsIdentity(props: AssetsIdentityProps) {
  const {
    base, quote, bridge = "USDT", coins, matrices, wallets, pct24h, histogram, className = "",
  } = props;

  const idx = useMemo(() => ({
    i: coins.indexOf(base.toUpperCase()),
    j: coins.indexOf(quote.toUpperCase()),
    u: coins.indexOf(bridge.toUpperCase()),
  }), [coins, base, quote, bridge]);

  const safe = (g?: NumGrid, a?: number, b?: number) =>
    a != null && b != null && a >= 0 && b >= 0 ? Number(g?.[a]?.[b]) : NaN;

  // Pair chips (benchm/id/pct24h)
  const benchm    = safe(matrices.benchmark, idx.i, idx.j);
  const idpq      = safe(matrices.id_pct,    idx.i, idx.j);

  // pct24h is pairwise from matrices.latest (units = %). It is NOT per-coin.
  // If the matrix isn’t populated, we fallback to coin→USDT map to derive pair pct.
  const pctPairDec = (() => {
    const m = safe(matrices.pct24h, idx.i, idx.j);
    if (Number.isFinite(m)) return Number(m) / 100; // convert % → decimal
    const a = pct24h?.[base.toUpperCase()];
    const b = pct24h?.[quote.toUpperCase()];
    return Number.isFinite(a) && Number.isFinite(b) ? (1 + (a as number)) / (1 + (b as number)) - 1 : NaN;
  })();

  // Bridge mini-row values
  const benchm_bu = safe(matrices.benchmark, idx.i, idx.u);
  const id_bu     = safe(matrices.id_pct,    idx.i, idx.u);
  const benchm_qu = safe(matrices.benchmark, idx.j, idx.u);
  const id_qu     = safe(matrices.id_pct,    idx.j, idx.u);

  // Wallet quick view
  const wBase   = fmt3(wallets?.[base]   ?? 0);
  const wQuote  = fmt3(wallets?.[quote]  ?? 0);
  const wBridge = fmt3(wallets?.[bridge] ?? 0);

  // Histogram: use provided or build from id_pct row (base → *)
  const histData: HistogramData | null = useMemo(() => {
    if (histogram?.edges?.length && histogram?.counts?.length) return histogram;
    const row = (idx.i >= 0 ? matrices.id_pct?.[idx.i] ?? [] : []);
    const vals = row.filter((v) => Number.isFinite(v)).map(Number);
    if (!vals.length) return null;

    const min = Math.min(...vals), max = Math.max(...vals);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
      // degenerate case: single value → make a tiny symmetric window
      const c = vals[0] ?? 0;
      const eps = Math.max(Math.abs(c) * 0.01, 1e-6);
      const edges = [c - eps, c + eps];
      return { edges, counts: [vals.length], label: "id_pct (dec)" };
    }

    const bins = 16;
    const edges = Array.from({ length: bins + 1 }, (_, k) => min + ((max - min) * k) / bins);
    const counts = Array.from({ length: bins }, () => 0);
    vals.forEach((v) => {
      let b = Math.floor(((v - min) / Math.max(1e-12, max - min)) * bins);
      if (b < 0) b = 0; if (b >= bins) b = bins - 1;
      counts[b]++;
    });
    return { edges, counts, label: "id_pct (dec)" };
  }, [histogram, matrices.id_pct, idx.i]);

  return (
    <div className={`rounded-xl border border-zinc-700/40 bg-zinc-900/60 p-3 ${className}`}>
      {/* Header chips */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-zinc-100">{base}/{quote}</div>
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-md text-[11px] font-mono border border-zinc-600/40 bg-zinc-800/60 text-zinc-200">
            benchm {fmt4(benchm)}
          </span>
          <span className="px-2 py-0.5 rounded-md text-[11px] font-mono border border-zinc-600/40 bg-zinc-800/60 text-zinc-200">
            id {fmt6(idpq)}
          </span>
          <span className="px-2 py-0.5 rounded-md text-[11px] font-mono border border-emerald-600/30 bg-emerald-600/10 text-emerald-200">
            pct24h {fmtPct2(pctPairDec)}
          </span>
        </div>
      </div>

      {/* Bridge mini-row */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="rounded-lg bg-zinc-900/70 border border-zinc-700/40 p-2">
          <div className="text-[11px] text-zinc-400">{base}→{bridge} · benchm / id</div>
          <div className="font-mono text-[13px]">
            {fmt4(benchm_bu)} <span className="text-zinc-500">/</span> {fmt6(id_bu)}
          </div>
        </div>
        <div className="rounded-lg bg-zinc-900/70 border border-zinc-700/40 p-2">
          <div className="text-[11px] text-zinc-400">{quote}→{bridge} · benchm / id</div>
          <div className="font-mono text-[13px]">
            {fmt4(benchm_qu)} <span className="text-zinc-500">/</span> {fmt6(id_qu)}
          </div>
        </div>
      </div>

      {/* Wallet */}
      <div className="rounded-xl border border-zinc-700/40 bg-zinc-900/70 p-2 mb-2">
        <div className="text-xs text-zinc-300 mb-1">Wallet</div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-zinc-900/80 border border-zinc-700/40 p-2">
            <div className="text-[11px] text-zinc-400">{base}</div>
            <div className="font-mono text-[13px]">{wBase}</div>
          </div>
          <div className="rounded-lg bg-zinc-900/80 border border-zinc-700/40 p-2">
            <div className="text-[11px] text-zinc-400">{quote}</div>
            <div className="font-mono text-[13px]">{wQuote}</div>
          </div>
          <div className="rounded-lg bg-zinc-900/80 border border-zinc-700/40 p-2">
            <div className="text-[11px] text-zinc-400">{bridge}</div>
            <div className="font-mono text-[13px]">{wBridge}</div>
          </div>
        </div>
      </div>

      {/* Histogram */}
      {histData ? <HistogramInline data={histData} /> : (
        <div className="rounded-xl border border-zinc-700/40 bg-zinc-900/70 p-2">
          <div className="text-xs text-zinc-300">Histogram</div>
          <div className="text-xs text-zinc-500">—</div>
        </div>
      )}
    </div>
  );
}
