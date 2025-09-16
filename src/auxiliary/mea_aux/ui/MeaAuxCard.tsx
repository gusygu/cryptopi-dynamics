// src/auxiliary/mea_aux/ui/MeaAuxCard.tsx
"use client";

import React, { useMemo } from "react";
import { useMeaAux } from "../hooks/useMeaAux";

/* ---------- helpers ---------- */
const fmt = (x: number | null | undefined) =>
  x == null || !Number.isFinite(Number(x)) ? "—" : Number(x).toFixed(6);

function cellClassByValue(v: number | null | undefined) {
  if (v == null) return "bg-slate-900 border-slate-800 text-slate-500";
  if (v === 0) return "bg-amber-900/30 border-amber-700/40 text-amber-200";
  const n = Number(v), m = Math.abs(n);
  const pos = [
    "bg-emerald-900/20 text-emerald-200 border-emerald-800/25",
    "bg-emerald-900/35 text-emerald-200 border-emerald-800/40",
    "bg-emerald-900/55 text-emerald-100 border-emerald-800/60",
  ];
  const neg = [
    "bg-rose-900/20 text-rose-200 border-rose-800/25",
    "bg-rose-900/35 text-rose-200 border-rose-800/40",
    "bg-rose-900/55 text-rose-100 border-rose-800/60",
  ];
  const band = m > 0.0008 ? 2 : m > 0.0003 ? 1 : 0;
  return n >= 0 ? pos[band] : neg[band];
}

export default function MeaAuxCard({
  coins: coinsProp,
  k,
  className = "",
}: {
  coins?: string[];
  k?: number;
  className?: string;
}) {
  const { data, grid, coins } = useMeaAux({ coins: coinsProp, k });
  const C = coins?.length ? coins : coinsProp ?? [];

  const rows = useMemo(() => {
    if (!grid || !C.length) return [];
    return C.map((A) => C.map((B) => Number.isFinite(grid?.[A]?.[B] as any) ? Number(grid[A][B]) : null));
  }, [grid, C]);

  return (
    <div className={["rounded-2xl bg-slate-950/60 border border-slate-800 p-4", className].join(" ")}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-slate-200 font-semibold">MEA-AUX</h3>
        {/* Poller-driven — no auto-refresh controls here */}
        <div className="text-xs text-slate-500">{C.join(" · ")}{typeof data?.k === "number" ? ` · k ${data.k}` : ""}</div>
      </div>

      <div className="overflow-auto">
        <table className="min-w-full border-separate border-spacing-2">
          <thead>
            <tr>
              <th className="text-xs text-slate-500 w-16"></th>
              {C.map((q) => (
                <th key={q} className="text-xs text-slate-400 text-right">{q}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {C.map((A, i) => (
              <tr key={A}>
                <td className="text-xs text-slate-400 pr-2">{A}</td>
                {C.map((B, j) => {
                  const v = i === j ? null : rows[i]?.[j] ?? null;
                  return (
                    <td key={A + B} className={["rounded px-2 py-1 text-right border", cellClassByValue(v)].join(" ")}>
                      {fmt(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
