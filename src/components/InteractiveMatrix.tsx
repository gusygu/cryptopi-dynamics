"use client";

import { useMemo } from "react";
import { fmt6 } from "@/lib/format";

type PreviewMap = Record<string, boolean>;
type NumMap = Record<string, number | undefined>;

export type InteractiveMatrixProps = {
  coins: string[];                            // order of matrix axes
  meaValues: NumMap;                          // key: `${base}-${quote}`
  idPctValues?: NumMap;                       // optional, for amber intensity
  previewAvailable?: PreviewMap;              // key: `${base}-${quote}` -> true/false
  className?: string;
};

const key = (a: string, b: string) => `${a}-${b}`;

function ringCls(avail: boolean | undefined) {
  if (avail === true)  return "ring-2 ring-emerald-400/80 ring-offset-2 ring-offset-emerald-400/10";
  if (avail === false) return "ring-2 ring-rose-400/80 ring-offset-2 ring-offset-rose-400/10";
  return "";
}

function amberFromIdPct(v?: number) {
  if (v == null || !Number.isFinite(v)) return "bg-slate-800/40";
  const a = Math.min(1, Math.abs(v) * 14); // tune factor for your id_pct scale
  // stronger amber as magnitude grows, keep text readable
  return `bg-amber-500/${Math.round(20 + a * 60)} text-slate-900`;
}

export default function InteractiveMatrix({
  coins,
  meaValues,
  idPctValues,
  previewAvailable,
  className = "",
}: InteractiveMatrixProps) {
  const rows = useMemo(() => coins, [coins]);

  return (
    <div className={`w-full ${className}`}>
      <div className="mb-2 flex items-center gap-2 text-xs text-slate-300">
        <span className="px-2 py-1 rounded-md bg-amber-500/40 text-slate-900 border border-amber-400/30">amber: |id_pct| intensity</span>
        <span className="px-2 py-1 rounded-md bg-slate-700/50 border border-slate-500/30">ring green: preview available</span>
        <span className="px-2 py-1 rounded-md bg-slate-700/50 border border-slate-500/30">ring red: preview unavailable</span>
      </div>

      <div className="overflow-auto rounded-xl border border-slate-600/40">
        <table className="min-w-full border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-slate-900/90 backdrop-blur px-2 py-2 text-left text-xs text-slate-400">/</th>
              {coins.map((c) => (
                <th key={`h-${c}`} className="px-2 py-2 text-xs font-medium text-slate-300">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`r-${r}`} className="border-t border-slate-700/40">
                <th className="sticky left-0 z-10 bg-slate-900/90 backdrop-blur px-2 py-2 text-xs font-medium text-slate-300">{r}</th>
                {coins.map((c) => {
                  const k = key(r, c);
                  const mea = meaValues[k];
                  const idp = idPctValues?.[k];
                  const avail = previewAvailable?.[k];

                  // Diagonal or missing
                  if (r === c) {
                    return (
                      <td key={k} className="px-2 py-1 text-center text-xs text-slate-500 bg-slate-900/60">—</td>
                    );
                  }

                  return (
                    <td key={k} className="px-1 py-1">
                      <div
                        className={[
                          "w-full rounded-lg px-2 py-1 text-right font-mono text-[11px] border border-slate-600/30",
                          amberFromIdPct(idp),
                          ringCls(avail),
                        ].join(" ")}
                        title={`Mea ${r}->${c}`}
                      >
                        {fmt6(mea)}
                      </div>
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
