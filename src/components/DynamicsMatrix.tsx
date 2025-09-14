// src/components/DynamicsMatrix.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useCoinsUniverse, useMeaGrid, usePreviewSymbols } from "@/lib/dynamicsClient";
import type { Coins, Grid } from "@/lib/dynamics.contracts";

type Props = {
  /** If omitted, uses Settings/ENV via useCoinsUniverse() */
  coins?: Coins;
  /** Controlled selection (optional) */
  base?: string;
  quote?: string;
  onSelect?: (base: string, quote: string) => void;
  /** Auto refresh cadence for MEA fetch (ms). 0/undefined = no auto. */
  autoRefreshMs?: number;
  className?: string;
  title?: string; // default "Dynamics — MEA Matrix"
};

export default function DynamicsMatrix({
  coins: coinsProp,
  base,
  quote,
  onSelect,
  autoRefreshMs = 0,
  className = "",
  title = "Dynamics — MEA Matrix",
}: Props) {
  const universe = useCoinsUniverse();
  const coins: Coins = useMemo(
    () => (coinsProp && coinsProp.length ? coinsProp : universe).map((c) => c.toUpperCase()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coinsProp?.join("|"), universe.join("|")]
  );

  const [sel, setSel] = useState<{ b: string; q: string }>(() => {
    const b = (base || coins[0] || "BTC").toUpperCase();
    const q = (quote || coins.find((c) => c !== b) || "USDT").toUpperCase();
    return { b, q };
  });

  useEffect(() => {
    const b = (base || sel.b || coins[0] || "BTC").toUpperCase();
    let q = (quote || sel.q || coins.find((c) => c !== b) || "USDT").toUpperCase();
    if (b === q) {
      const alt = coins.find((c) => c !== b);
      if (alt) q = alt;
    }
    setSel((old) => (old.b === b && old.q === q ? old : { b, q }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, quote, coins.join("|")]);

  // MEA grid fetch
  const { grid: raw, loading, error, refresh } = useMeaGrid(coins);
  const grid: Grid | undefined = useMemo(() => {
    if (!raw) return undefined;
    const any: any = raw;
    if (Array.isArray(any)) return any as Grid;
    if (any && Array.isArray(any.weights)) return any.weights as Grid;
    return undefined;
  }, [raw]);

  // preview availability rings
  const { symbols: previewSyms } = usePreviewSymbols();
  const hasPreview = useMemo(() => {
    const s = new Set(previewSyms.map((x) => String(x || "").toUpperCase()));
    return (A: string, B: string) => s.has(`${A}${B}`.toUpperCase());
  }, [previewSyms]);

  // auto refresh
  useEffect(() => {
    if (!autoRefreshMs || autoRefreshMs < 5_000) return;
    const id = setInterval(() => refresh(), autoRefreshMs);
    return () => clearInterval(id);
  }, [autoRefreshMs, refresh]);

  const clickCell = (b: string, q: string) => {
    if (b === q) return;
    setSel({ b, q });
    onSelect?.(b, q);
  };

  return (
    <div className={["rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm shadow-lg", className].join(" ")}>
      {/* header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
          <Legend />
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-slate-400">
            Selected:{" "}
            <span className="font-mono text-slate-300">
              {sel.b}/{sel.q}
            </span>
          </span>
          <button
            onClick={refresh}
            className="rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800/60"
            title="Refresh MEA"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* grid */}
      <div className="px-4 pb-4 overflow-auto">
        {loading && !grid ? (
          <div className="text-slate-400 text-sm">Loading MEA…</div>
        ) : error ? (
          <div className="text-rose-300 text-sm">Error: {error}</div>
        ) : !grid || !coins.length ? (
          <div className="text-slate-400 text-sm">No data.</div>
        ) : (
          <table className="min-w-max text-[11px]">
            <thead className="sticky top-0 bg-slate-900/80 backdrop-blur">
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
                  <th className="pr-2 py-1 sticky left-0 bg-slate-900/80 backdrop-blur text-right text-slate-400 font-mono tabular-nums">
                    {coins[i]}
                  </th>
                  {row.map((v, j) => {
                    const b = coins[i], q = coins[j];
                    const isDiag = i === j;
                    const isSel = sel.b === b && sel.q === q;
                    const preview = !isDiag && hasPreview(b, q);

                    return (
                      <td key={`c-${i}-${j}`} className="px-0.5 py-0.5">
                        {isDiag ? (
                          <div
                            className="w-[86px] h-[22px] rounded-lg border border-dashed border-slate-700/50 bg-slate-800/50"
                            title="—"
                          />
                        ) : (
                          <button
                            onClick={() => clickCell(b, q)}
                            className={[
                              "w-[86px] h-[22px] rounded-lg border shadow-inner font-mono tabular-nums",
                              "px-1.5 text-[11px]",
                              colorCls(v),
                              ringCls({ isSel, preview }),
                            ].join(" ")}
                            title={`${b}/${q}`}
                          >
                            {fmt6(v)}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ───────────────────── legend & color helpers ───────────────────── */

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
      <Chip color="amber">amber: neutral (0.000000)</Chip>
      <Chip color="emerald">green: &gt; 0</Chip>
      <Chip color="rose">red: &lt; 0</Chip>
      <Ring color="emerald">preview available</Ring>
      <Ring color="rose">preview unavailable</Ring>
      <Ring color="blue">selected pair</Ring>
    </div>
  );
}

function Chip({ color, children }: { color: "amber" | "emerald" | "rose"; children: React.ReactNode }) {
  const map = {
    amber: "border-amber-700/60 bg-amber-950/30 text-amber-200 ring-1 ring-amber-800/40",
    emerald: "border-emerald-700/60 bg-emerald-950/30 text-emerald-200 ring-1 ring-emerald-800/40",
    rose: "border-rose-700/60 bg-rose-950/30 text-rose-200 ring-1 ring-rose-800/40",
  } as const;
  return <span className={["inline-flex items-center rounded-lg px-2 py-0.5 border", map[color]].join(" ")}>{children}</span>;
}

function Ring({ color, children }: { color: "emerald" | "rose" | "blue"; children: React.ReactNode }) {
  const map = {
    emerald: "ring-1 ring-emerald-500/70",
    rose: "ring-1 ring-rose-500/70",
    blue: "ring-2 ring-sky-400/80",
  } as const;
  return (
    <span className={["inline-flex items-center rounded-lg px-2 py-0.5 border border-slate-700/60 bg-slate-900/40", map[color]].join(" ")}>
      {children}
    </span>
  );
}

function fmt6(v: number | null): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  if (v === 0) return "0.000000";
  return Number(v).toFixed(6);
}

function colorCls(v: number | null) {
  if (v == null || !Number.isFinite(Number(v))) {
    return "bg-slate-900/40 text-slate-500 border-slate-800/40";
  }
  if (v === 0) {
    return "bg-amber-900/30 text-amber-200 border-amber-700/40";
  }
  const n = Number(v);
  const m = Math.abs(n);
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
  return n > 0 ? pos[idx] : neg[idx];
}

function ringCls({ isSel, preview }: { isSel: boolean; preview: boolean }) {
  // availability ring (green/red), selected overlay is blue & thicker
  const avail = preview ? "ring-1 ring-emerald-500/70" : "ring-1 ring-rose-500/70";
  const sel = isSel ? "ring-2 ring-sky-400/80 shadow-[0_0_0_1px_rgba(56,189,248,0.3)]" : "";
  return [avail, sel].filter(Boolean).join(" ");
}
