// src/components/DynamicsMatrix.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { subscribe } from "@/lib/pollerClient";
import { useCoinsUniverse, useMatricesLatest, usePreviewSymbols, useMeaGrid } from "@/lib/dynamicsClient";
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

  // Fetch flags (bridged mask) from matrices/latest; render values from MEA
  const { data, loading: loadingMatrices, error: errorMatrices, refresh: refreshMatrices } = useMatricesLatest(coins);
  const mats: any = data?.matrices ?? {};

  const { grid: meaRaw, loading: loadingMea, error: errorMea, refresh: refreshMea } = useMeaGrid(coins);
  const grid: Grid | undefined = useMemo(() => {
    if (!meaRaw) return undefined;
    const anyGrid: any = meaRaw as any;
    if (Array.isArray(anyGrid)) return anyGrid as Grid;
    if (anyGrid && Array.isArray(anyGrid.weights)) return anyGrid.weights as Grid;
    if (anyGrid && typeof anyGrid === 'object') {
      const n = coins.length;
      const out: (number|null)[][] = Array.from({ length: n }, () => Array(n).fill(null));
      const idx = Object.fromEntries(coins.map((c, i) => [String(c).toUpperCase(), i]));
      for (const b of Object.keys(anyGrid)) {
        const i = idx[String(b).toUpperCase()];
        if (i == null) continue;
        const row = anyGrid[b] || {};
        for (const q of Object.keys(row)) {
          const j = idx[String(q).toUpperCase()];
          if (j == null) continue;
          const v = row[q];
          out[i][j] = v == null ? null : Number(v);
        }
      }
      return out as Grid;
    }
    return undefined;
  }, [meaRaw, coins.join('|')]);

  const loading = loadingMea || loadingMatrices;
  const error = errorMea || errorMatrices;

  // Bridged mask (USDT triangulation) from flags
  const bridgedMask: boolean[][] | null = useMemo(() => {
    const f: any = data?.flags ?? {};
    const idp = f?.id_pct?.bridged as boolean[][] | undefined;
    if (Array.isArray(idp)) return idp as any;
    const pct = f?.pct24h?.bridged as boolean[][] | undefined;
    if (Array.isArray(pct)) return pct as any;
    return null;
  }, [data]);

  // preview availability rings
  const { symbols: previewSyms } = usePreviewSymbols(coins);
  const hasPreviewExact = useMemo(() => {
    const s = new Set(previewSyms.map((x) => String(x || "").toUpperCase()));
    return (A: string, B: string) => s.has(`${A}${B}`.toUpperCase());
  }, [previewSyms]);
  const hasPreviewAny = useMemo(() => {
    const s = new Set(previewSyms.map((x) => String(x || "").toUpperCase()));
    return (A: string, B: string) => s.has(`${A}${B}`.toUpperCase()) || s.has(`${B}${A}`.toUpperCase());
  }, [previewSyms]);

  // central poller-driven refresh (no local timers)
  useEffect(() => {
    const unsub = subscribe((ev) => {
      if (ev.type === "tick40" || ev.type === "tick120" || ev.type === "refresh") {
        refreshMea();
        refreshMatrices();
      }
    });
    return () => { unsub(); };
  }, [refreshMea, refreshMatrices]);

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
            onClick={() => { refreshMea(); refreshMatrices(); }}
            className="rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800/60"
            title="Refresh"
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
                    const previewExact = !isDiag && hasPreviewExact(b, q);
                    const previewAny = !isDiag && hasPreviewAny(b, q);
                    const bridged = !!bridgedMask?.[i]?.[j];

                    // Effective value: v, else synth from delta/benchmark when available
                    let vEff: number | null = (v == null || !Number.isFinite(Number(v))) ? null : Number(v);
                    if (vEff == null) {
                      const d = Number((mats?.delta as any)?.[i]?.[j]);
                      const bm = Number((mats?.benchmark as any)?.[i]?.[j]);
                      if (Number.isFinite(d) && Number.isFinite(bm) && bm !== 0) {
                        vEff = d / bm; // approx id_pct from absolute delta
                      }
                    }

                    return (
                      <td key={`c-${i}-${j}`} className="px-0.5 py-0.5">
                        {isDiag ? (
                          <div
                            className="w-[86px] h-[22px] rounded-lg border border-dashed border-slate-700/50 bg-slate-800/50"
                            title="-"
                          />
                        ) : (
                          <button
                            onClick={() => clickCell(b, q)}
                            className={[
                              "w-[86px] h-[22px] rounded-lg border shadow-inner font-mono tabular-nums",
                              "px-1.5 text-[11px]",
                              colorCls(vEff),
                              ringCls({ isSel, previewExact, previewAny, bridged }),
                              "border-solid",
                            ].join(" ")}
                            title={`${b}/${q}${bridged ? " • bridged via USDT" : ""}${previewExact ? " • preview market" : (previewAny ? " • opposite-only" : " • no preview")}`}
                          >
                            {fmt6(vEff)}
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
      <span className="inline-flex items-center rounded-lg px-2 py-0.5 border border-dashed border-slate-600/70 bg-slate-900/40">USDT-bridged</span>
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

function Ring({ color, children }: { color: "emerald" | "rose" | "blue" | "slate"; children: React.ReactNode }) {
  const map = {
    emerald: "ring-2 ring-lime-600/80 shadow-[0_0_0_2px_rgba(101,163,13,0.28)]",
    rose: "ring-2 ring-rose-600/80 shadow-[0_0_0_2px_rgba(225,29,72,0.28)]",
    blue: "ring-2 ring-sky-500/90 shadow-[0_0_0_3px_rgba(56,189,248,0.32)]",
    slate: "ring-2 ring-slate-500/70 shadow-[0_0_0_2px_rgba(100,116,139,0.25)]",
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

function ringCls({ isSel, previewExact, previewAny, bridged }: { isSel: boolean; previewExact: boolean; previewAny: boolean; bridged: boolean }) {
  // availability ring (green exact, red opposite-only, grey none). Bridged cells are grey-only.
  const base = bridged
    ? "ring-2 ring-slate-500/70 shadow-[0_0_0_2px_rgba(100,116,139,0.25)]"
    : (previewExact
        ? "ring-2 ring-lime-600/80 shadow-[0_0_0_2px_rgba(101,163,13,0.28)]"
        : (previewAny
            ? "ring-2 ring-rose-600/80 shadow-[0_0_0_2px_rgba(225,29,72,0.28)]"
            : "ring-2 ring-slate-500/70 shadow-[0_0_0_2px_rgba(100,116,139,0.25)]"));
  const sel = isSel ? "ring-2 ring-sky-500/90 shadow-[0_0_0_3px_rgba(56,189,248,0.32)]" : "";
  return [base, sel].filter(Boolean).join(" ");
}
