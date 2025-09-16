// src/components/ArbTable.tsx
"use client";

/**
 * CryptoPi Dynamics — ArbTable
 * - 3 path columns (Cb→Ci, Ci→Ca, Ca→Ci)
 * - Metrics per column: benchm, id_pct (+swap pill), drv% (vTendency)
 * - Wallet strip (top-right)
 * - Poller-driven updates via the feeding hook (useArbRows)
 * - UI coloring lives here; data stays neutral
 */

import React, { useMemo, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import type { ArbRow } from "@/lib/dynamicsClient";

export type ArbTableProps = {
  Ca: string;
  Cb: string;
  candidates: string[];
  wallets?: Record<string, number>;
  rows: ArbRow[];
  loading?: boolean;
  className?: string;
  defaultSort?: { key: "id_pct" | "benchmark" | "symbol"; dir: "asc" | "desc" };
  onRowClick?: (ci: string) => void;
};

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}
const fmt = {
  num(n?: number, p = 4) {
    if (n === undefined || n === null || Number.isNaN(n)) return "—";
    return Number(n).toLocaleString(undefined, { minimumFractionDigits: Math.min(2, p), maximumFractionDigits: p });
  },
};
type EdgeKey = "cb_ci" | "ci_ca" | "ca_ci";

function getEdge(row: ArbRow, edge: EdgeKey) {
  return row?.cols?.[edge] ?? (row as any)?.[edge] ?? row?.metrics ?? {};
}

function SwapPill({ count, changedAtIso }: { count?: number; changedAtIso?: string }) {
  const n = Number(count || 0);
  const recentSec = (() => {
    const ts = changedAtIso ? Date.parse(changedAtIso) : 0;
    return ts ? Math.max(0, (Date.now() - ts) / 1000) : Infinity;
  })();
  const tone = n > 0 ? "emerald" : "zinc";
  const base =
    tone === "emerald"
      ? "bg-emerald-600/20 text-emerald-200 border-emerald-500/30"
      : "bg-zinc-700/30 text-zinc-200 border-zinc-500/30";
  const glow = recentSec < 6 ? "shadow-[0_0_0_2px_rgba(52,211,153,0.35)]" : "";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-[2px] font-mono text-[11px] ${base} ${glow}`}>
      <span>{n}</span>
      <span className="text-[10px] opacity-70">swaps</span>
    </span>
  );
}

function WalletsStrip({ wallets, coins }: { wallets?: Record<string, number>; coins: string[] }) {
  const seen = new Set<string>();
  const chips = (coins || [])
    .map((c) => c.toUpperCase())
    .filter((c) => { if (seen.has(c)) return false; seen.add(c); return true; })
    .map((c) => ({ coin: c, bal: Number((wallets ?? {})[c] ?? 0) }))
    .filter((x) => Number.isFinite(x.bal))
    .sort((a, b) => b.bal - a.bal)
    .slice(0, 6);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {chips.map((ch) => (
        <span
          key={ch.coin}
          className={cx(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border",
            "border-slate-800 bg-slate-950/40 text-slate-200",
            ch.bal > 0 ? "ring-1 ring-emerald-800/40" : "opacity-60"
          )}
          title={`${ch.coin} · ${fmt.num(ch.bal, 6)}`}
        >
          <span className="font-semibold">{ch.coin}</span>
          <span className="font-mono tabular-nums">{fmt.num(ch.bal, 4)}</span>
        </span>
      ))}
    </div>
  );
}

export default function ArbTable({
  Ca, Cb, candidates, wallets, rows, loading, className = "", defaultSort = { key: "id_pct", dir: "desc" }, onRowClick,
}: ArbTableProps) {
  const B = Cb.toUpperCase();
  const A = Ca.toUpperCase();
  const [sort, setSort] = useState(defaultSort);

  const sorted = useMemo(() => {
    const out = [...(rows || [])];
    if (sort.key === "symbol") {
      out.sort((r1, r2) => r1.ci.localeCompare(r2.ci) * (sort.dir === "asc" ? 1 : -1));
      return out;
    }
    const pick = (r: ArbRow) =>
      (getEdge(r, "cb_ci")?.[sort.key] ??
        getEdge(r, "ci_ca")?.[sort.key] ??
        getEdge(r, "ca_ci")?.[sort.key] ??
        -Infinity) as number;
    out.sort((a, b) => (Number(pick(b)) - Number(pick(a))) * (sort.dir === "asc" ? -1 : 1));
    return out;
  }, [rows, sort]);

  const headerBtn = (label: string, key: "symbol" | "benchmark" | "id_pct") => {
    const active = sort.key === key;
    return (
      <button
        className={cx(
          "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
          active ? "border-emerald-700/60 bg-emerald-950/30 text-emerald-200" : "border-slate-700/60 bg-slate-900/60 text-slate-200"
        )}
        onClick={() => setSort((s) => (s.key === key ? { ...s, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }))}
        title={`Sort by ${label}`}
      >
        <ArrowUpDown className="h-3.5 w-3.5" />
        <span>{label}</span>
      </button>
    );
  };
      const fmt = {
        num(n?: number, p = 4) {
          if (n == null || Number.isNaN(n)) return "—";
          return Number(n).toLocaleString(undefined, { minimumFractionDigits: Math.min(2, p), maximumFractionDigits: p });
        },
      };
    return (
    <div className={cx("rounded-xl border border-slate-800 bg-slate-950/40", className)}>
      <div className="flex items-center justify-between px-3 py-2">
        <div className="text-sm font-semibold text-slate-200">Arbitrage paths · {B} ↔ {A}</div>
        <WalletsStrip wallets={wallets} coins={[...new Set([A, B, ...candidates.map((c) => c.toUpperCase())])]} />
      </div>

      <div className="px-3 pb-2 flex items-center gap-2 flex-wrap">
        {headerBtn("symbol", "symbol")}
        {headerBtn("id_pct", "id_pct")}
        {headerBtn("benchm", "benchmark")}
        {loading ? <span className="text-[11px] text-slate-400">updating…</span> : null}
      </div>

      <table className="w-full text-xs border-t border-slate-800 table-fixed">
  <colgroup>
    <col className="w-[18%]" /> {/* CI */}
    <col className="w-[20%]" /> {/* Cb→Ci */}
    <col className="w-[20%]" /> {/* Ci→Ca */}
    <col className="w-[20%]" /> {/* Ca→Ci */}
    <col className="w-[22%]" /> {/* Swaps */}
  </colgroup>
        <thead>
          <tr className="text-slate-400">
            <th className="px-2 py-1 text-left">CI</th>
            <th className="px-2 py-1 text-right">{B}→CI</th>
            <th className="px-2 py-1 text-right">CI→{A}</th>
            <th className="px-2 py-1 text-right">{A}→CI</th>
            <th className="px-2 py-1 text-right">Swaps</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const cb_ci = getEdge(r, "cb_ci");
            const ci_ca = getEdge(r, "ci_ca");
            const ca_ci = getEdge(r, "ca_ci");
            return (
              <tr key={r.ci} className="border-t border-slate-800 hover:bg-slate-900/30" onClick={() => onRowClick?.(r.ci)}>
                <td className="px-2 py-1 text-slate-300">{r.ci}</td>
                <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">
                  <div className="flex flex-col items-end leading-tight">
                    <span className="whitespace-nowrap" title="id_pct">{fmt.num(cb_ci?.id_pct)}</span>
                    <span className="text-[10px] text-slate-400 whitespace-nowrap" title="benchmark">
                      {fmt.num(cb_ci?.benchmark)}
                    </span>
                  </div>
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  <div className="flex flex-col items-end">
                    <span title="id_pct">{fmt.num(ci_ca?.id_pct)}</span>
                    <span className="text-[10px] text-slate-400" title="benchmark">{fmt.num(ci_ca?.benchmark)}</span>
                  </div>
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  <div className="flex flex-col items-end">
                    <span title="id_pct">{fmt.num(ca_ci?.id_pct)}</span>
                    <span className="text-[10px] text-slate-400" title="benchmark">{fmt.num(ca_ci?.benchmark)}</span>
                  </div>
                </td>
                <td className="px-2 py-1 text-right">
                  <SwapPill
                    count={cb_ci?.swapTag?.count ?? ci_ca?.swapTag?.count ?? ca_ci?.swapTag?.count}
                    changedAtIso={cb_ci?.swapTag?.changedAtIso ?? ci_ca?.swapTag?.changedAtIso ?? ca_ci?.swapTag?.changedAtIso}
                  />
                </td>
              </tr>
            );
          })}
          {sorted.length === 0 && !loading ? (
            <tr><td colSpan={5} className="px-2 py-3 text-center text-[11px] text-slate-400">no rows</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
