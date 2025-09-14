"use client";

import { useMemo } from "react";
import { fmt6 } from "@/lib/format";
import { buildPairsMap, hasBaseWallet } from "@/lib/pairs";

type NumGrid = number[][];
type Wallets = Record<string, number>;

export type DynamicsMatrixProps = {
  coins: string[];
  mea: number[][];
  previewSymbols?: string[];
  wallets?: Record<string, number>;
  onSelect?: (base: string, quote: string) => void; // NEW
  className?: string;
};

// visual keys
const k = (a: string, b: string) => `${a}-${b}`;

// treat Mea "zero" as exactly what will display as 0.00 (no tint)
function isMeaZero(v: number | undefined): boolean {
  if (!Number.isFinite(Number(v))) return true;
  return Math.abs(Number(v)) < 0.005; // rounds to 0.00
}

// shade helpers (Tailwind opacity steps)
function greenShade(v: number) {
  const mag = Math.min(1, Math.abs(v) / 0.02); // clamp @ ~2%
  const alpha = 20 + Math.round(mag * 60);     // 20%..80%
  return `bg-emerald-500/${alpha} text-slate-900`;
}
function redShade(v: number) {
  const mag = Math.min(1, Math.abs(v) / 0.02);
  const alpha = 20 + Math.round(mag * 60);
  return `bg-rose-500/${alpha} text-slate-900`;
}
function amber() {
  return "bg-amber-400/50 text-slate-900";
}

function ringCls(avail: boolean | undefined) {
  if (avail === true)  return "ring-2 ring-emerald-400/80 ring-offset-2 ring-offset-emerald-400/10";
  if (avail === false) return "ring-2 ring-rose-400/80 ring-offset-2 ring-offset-rose-400/10";
  return "";
}

export default function DynamicsMatrix({
  coins, mea, previewSymbols, wallets, onSelect, className = "",
}: DynamicsMatrixProps) {
  const pairs = useMemo(() => buildPairsMap(coins, previewSymbols), [coins, previewSymbols]);
  const N = coins.length;

  return (
    <div className={`w-full ${className}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
        <span className="px-2 py-0.5 rounded bg-emerald-500/35 text-slate-900 border border-emerald-400/30">green: Mea &gt; 0</span>
        <span className="px-2 py-0.5 rounded bg-rose-500/35 text-slate-900 border border-rose-400/30">red: Mea &lt; 0</span>
        <span className="px-2 py-0.5 rounded bg-amber-400/45 text-slate-900 border border-amber-400/30">amber: 0.00 or no base wallet</span>
        <span className="px-2 py-0.5 rounded bg-slate-800/60 border border-slate-600/30">ring: preview availability</span>
      </div>

      <div className="overflow-auto rounded-xl border border-slate-700/40 bg-[#0c0f14]/70">
        <table className="min-w-full border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[#0c0f14] px-2 py-2 text-left text-xs text-slate-400">/</th>
              {coins.map((c) => (
                <th key={`h-${c}`} className="px-2 py-2 text-xs font-medium text-slate-200">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {coins.map((row, i) => (
              <tr key={`r-${row}`} className="border-t border-slate-800/50">
                <th className="sticky left-0 z-10 bg-[#0c0f14] px-2 py-2 text-xs font-medium text-slate-200">{row}</th>
                {coins.map((col, j) => {
                  if (row === col) {
                    return <td key={`${row}-${col}`} className="px-2 py-1 text-center text-xs text-slate-600 bg-[#0c0f14]">—</td>;
                  }
                  const m = Number(mea?.[i]?.[j]);
                  const ring = ringCls(pairs[`${row}-${col}`]);

                  let bg = amber();
                  if (hasBaseWallet(row, wallets) && !isMeaZero(m)) bg = m > 0 ? greenShade(m) : redShade(m);

                  return (
                    <td key={`${row}-${col}`} className="px-1 py-1">
                      <button
                        type="button"
                        onClick={() => onSelect?.(row, col)} // NEW
                        className={[
                          "w-full rounded-md px-2 py-1 text-right font-mono text-[11px] border border-slate-700/40 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 transition",
                          bg, ring,
                        ].join(" ")}
                        title={`select ${row} → ${col}`}
                      >
                        {fmt6(m)}
                      </button>
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
