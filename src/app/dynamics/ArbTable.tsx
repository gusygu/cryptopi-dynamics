"use client";

// /src/components/ArbTable.tsx — CryptoPi Dynamics (converter-wired UI)
// ---------------------------------------------------------------------
// • 3 path columns per candidate (Cb→Ci, Ci→Ca, Ca→Ci) + wallets column
// • Per-column stacked metrics (bm, id_pct+swap, vTendency+inertia)
// • Sorting (id_pct | benchmark | symbol), stable
// • Row action (inspect) via onRowClick
// • Loading/empty states; a11y-friendly
// • No stubs created here — values come from props (converter)

import React, { useMemo, useState } from "react";
import type { JSX } from "react";
import {
  ChevronUp,
  ChevronDown,
  Pause,
  ArrowUpDown,
  MoreHorizontal,
  RefreshCcw,
} from "lucide-react";

// ---------- Types ----------
export type SwapDirection = "up" | "down" | "frozen";

export type SwapTag = {
  count: number;
  direction: SwapDirection;
  changedAtIso?: string;
};

export type RowMetrics = {
  benchmark: number;                 // unitless
  id_pct: number;                    // ±%
  vTendency?: "up" | "down" | "flat";
  inertia?: "low" | "neutral" | "high" | "frozen";
  swapTag: SwapTag;
};

export type ArbRow = {
  ci: string;          // candidate coin
  metrics: RowMetrics; // metrics for this Ci
};

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

// ---------- Utilities ----------
const fmt = {
  num(n?: number, p = 4) {
    if (n === undefined || n === null || Number.isNaN(n)) return "–";
    return Number(n).toLocaleString(undefined, {
      minimumFractionDigits: Math.min(2, p),
      maximumFractionDigits: p,
    });
  },
  pct(n?: number) {
    if (n === undefined || n === null || Number.isNaN(n)) return "–";
    const abs = Math.abs(n);
    const d = abs < 1e-4 ? 8 : abs < 1e-2 ? 6 : 3; // more precision for tiny values
    const sign = n > 0 ? "+" : n < 0 ? "" : "";
    return `${sign}${n.toFixed(d)}%`;
  },
};

function classNames(...xs: Array<string | false | undefined>) {
  return xs.filter(Boolean).join(" ");
}

// ---------- Small UI primitives ----------
function Badge(
  {
    children,
    className = "",
    ...rest
  }: React.PropsWithChildren<React.HTMLAttributes<HTMLSpanElement>>
): JSX.Element {
  return (
    <span
      {...rest}
      className={classNames(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        className
      )}
    >
      {children}
    </span>
  );
}

function SwapPill({ tag }: { tag: SwapTag }) {
  const color =
    tag.direction === "up"
      ? "bg-blue-500/70 text-blue-50"
      : tag.direction === "down"
      ? "bg-orange-500/70 text-orange-50"
      : "bg-slate-700 text-slate-300";

  const hhmm =
    tag.changedAtIso
      ? new Date(tag.changedAtIso).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : "–";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 ${color}`}
      title={
        tag.changedAtIso
          ? `last flip at ${new Date(tag.changedAtIso).toLocaleString()}`
          : "no recent flips"
      }
    >
      {/* small flip count */}
      <span className="text-[10px] leading-none font-mono tabular-nums">{tag.count}</span>
      {/* last flip time hh:mm */}
      <span className="text-[10px] leading-none font-mono tabular-nums">{hhmm}</span>
    </span>
  );
}


function WalletStrip({
  Ca,
  Cb,
  Ci,
  wallets = {},
}: {
  Ca: string;
  Cb: string;
  Ci: string;
  wallets?: Record<string, number>;
}) {
  const items: { sym: string; amt: number | undefined }[] = [
    { sym: Ca, amt: wallets[Ca] },
    { sym: Cb, amt: wallets[Cb] },
    { sym: Ci, amt: wallets[Ci] },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map(({ sym, amt }) => (
        <Badge
          key={sym}
          className="bg-slate-700/40 text-slate-200 ring-1 ring-inset ring-slate-600/60"
        >
          <span className="font-semibold">{sym}</span>
          <span className="opacity-80 tabular-nums">{fmt.num(amt, 6)}</span>
        </Badge>
      ))}
    </div>
  );
}

function CellPath({ left, right }: { left: string; right: string }) {
  return (
    <div className="col-span-3">
      <div
        className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2"
        title={`${left} to ${right}`}
      >
        <span className="text-sm font-medium text-slate-100">{left}</span>
        <span className="text-slate-500">→</span>
        <span className="text-sm font-medium text-slate-100">{right}</span>
      </div>
    </div>
  );
}

function ColumnMetrics({
  m,
}: {
  m: { benchmark: number; id_pct: number; vTendency?: number; swapTag: SwapTag };
}) {
  const id = Number.isFinite(m.id_pct) ? m.id_pct : 0;
  const bm = Number.isFinite(m.benchmark) ? m.benchmark : 0;
  return (
    <div className="mt-2 grid gap-1 text-[11px] text-slate-300">
      {/* 1) benchmark - 3 dp */}
      <div className="flex items-center gap-2">
        <span className="opacity-70">bm</span>
        <span className="tabular-nums">{bm.toFixed(4)}</span>
      </div>

      {/* 2) id_pct - 6 dp + swap */}
      <div className="flex items-center gap-2">
        <span className="opacity-70">id_pct</span>
        <span className="tabular-nums">{id.toFixed(6)}</span>
        <SwapPill tag={m.swapTag} />
      </div>

      {/* 3) vTendency - numeric */}
      <div className="flex items-center gap-2">
        <span className="opacity-70">vTendency</span>
        <span className="tabular-nums">{(m.vTendency ?? 0).toFixed(4)}</span>
      </div>

      {/* 4) reserved for future use */}
      <div className="flex items-center gap-2">
        <span className="opacity-70">extra</span>
        <span className="tabular-nums">—</span>
      </div>
    </div>
  );
}



// ---------- Sorting ----------
type SortKey = "symbol" | "id_pct" | "benchmark";
type SortState = { key: SortKey; dir: "asc" | "desc" };

// prefer the Ca→Ci edge for sorting (stable + predictable),
// and fall back to legacy row.metrics if cols is not present.
function edgeForSort(row: any) {
  if (row?.cols?.ca_ci) return row.cols.ca_ci;
  if (row?.metrics) return row.metrics;
  return { id_pct: 0, benchmark: 0 } as { id_pct: number; benchmark: number };
}

function sortRows(rows: any[], state: SortState): any[] {
  const { key, dir } = state;
  const sgn = dir === "asc" ? 1 : -1;
  const stable = rows.map((r, i) => ({ r, i }));

  stable.sort((a, b) => {
    if (key === "symbol") {
      const sa = String(a.r?.ci ?? "");
      const sb = String(b.r?.ci ?? "");
      const cmp = sa.localeCompare(sb);
      return cmp !== 0 ? cmp * sgn : a.i - b.i; // stability
    }

    const ea = edgeForSort(a.r);
    const eb = edgeForSort(b.r);
    const va =
      key === "id_pct"
        ? (Number.isFinite(ea.id_pct) ? ea.id_pct : 0)
        : (Number.isFinite(ea.benchmark) ? ea.benchmark : 0);
    const vb =
      key === "id_pct"
        ? (Number.isFinite(eb.id_pct) ? eb.id_pct : 0)
        : (Number.isFinite(eb.benchmark) ? eb.benchmark : 0);

    const cmp = va - vb;
    return cmp !== 0 ? cmp * sgn : a.i - b.i; // stability
  });

  return stable.map((x) => x.r);
}


// ---------- Component ----------
export default function ArbTable({
  Ca,
  Cb,
  candidates,
  wallets = {},
  rows,
  loading = false,
  className = "",
  defaultSort = { key: "id_pct", dir: "desc" },
  onRowClick,
}: ArbTableProps) {
  const [sort, setSort] = useState<SortState>(defaultSort);
  const rowMap = useMemo(() => new Map(rows.map((r) => [r.ci, r.metrics])), [rows]);
  const ordered: ArbRow[] = useMemo(() => sortRows(rows, sort), [rows, sort]);
  
  return (
    <section
      className={classNames(
        "rounded-2xl border border-slate-800 bg-slate-900/60 shadow-lg",
        className
      )}
      aria-label="Arbitrage table"
    >
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-800 bg-slate-900/80 px-4 py-3 backdrop-blur">
        <h3 className="text-base font-semibold text-slate-100">Arbitrage paths</h3>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span>Pair:</span>
          <span className="font-medium text-slate-200">{Ca}</span>
          <span>/</span>
          <span className="font-medium text-slate-200">{Cb}</span>
          <button
            type="button"
            className="ml-3 inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800"
            title="Reset sort"
            onClick={() => setSort(defaultSort)}
          >
            <RefreshCcw className="h-3.5 w-3.5" /> reset
          </button>
        </div>
      </div>

      {/* Column labels with sort controls */}
      <div className="grid grid-cols-12 gap-3 px-4 pt-3 pb-2 text-[11px] uppercase tracking-wide text-slate-400">
        <div className="col-span-3">Cb → Ci</div>
        <div className="col-span-3">Ci → Ca</div>
        <div className="col-span-3">Ca → Ci</div>
        <div className="col-span-3 flex items-center justify-end gap-2">
          <span>wallets</span>
          <SortButton
            label="symbol"
            active={sort.key === "symbol"}
            dir={sort.dir}
            onClick={() => toggleSort(setSort, sort, "symbol")}
          />
          <SortButton
            label="id_pct"
            active={sort.key === "id_pct"}
            dir={sort.dir}
            onClick={() => toggleSort(setSort, sort, "id_pct")}
          />
          <SortButton
            label="benchmark"
            active={sort.key === "benchmark"}
            dir={sort.dir}
            onClick={() => toggleSort(setSort, sort, "benchmark")}
          />
        </div>
      </div>

      {/* States */}
      {loading && (
        <div className="px-4 pb-4 text-sm text-slate-400">Loading arbitrage rows…</div>
      )}
      {!loading && ordered.length === 0 && (
        <div className="px-4 pb-4 text-sm text-slate-400">No candidates available.</div>
      )}

      {/* Rows */}
<div className="divide-y divide-slate-800">
  {ordered.map((row) => {
    const ci = (row as any).ci as string;

    const col = (name: "cb_ci" | "ci_ca" | "ca_ci") =>
      ((row as any).cols && (row as any).cols[name]) || (row as any).metrics;

    return (
      <div key={ci} className="px-2">
        {/* Main row: three paths + wallet/actions */}
        <div className="grid grid-cols-12 items-center gap-3 px-2 pt-2">
          <div className="col-span-3"><CellPath left={Cb} right={ci} /></div>
          <div className="col-span-3"><CellPath left={ci} right={Ca} /></div>
          <div className="col-span-3"><CellPath left={Ca} right={ci} /></div>
          <div className="col-span-3 flex items-center justify-end gap-2">
            <WalletStrip Ca={Ca} Cb={Cb} Ci={ci} wallets={wallets} />
            <RowMenu ci={ci} onInspect={() => onRowClick?.(ci)} />
          </div>
        </div>

        {/* Per-column metric stacks */}
        <div className="grid grid-cols-12 gap-3 px-2 pb-3">
          <div className="col-span-3"><ColumnMetrics m={col("cb_ci")} /></div>
          <div className="col-span-3"><ColumnMetrics m={col("ci_ca")} /></div>
          <div className="col-span-3"><ColumnMetrics m={col("ca_ci")} /></div>
          <div className="col-span-3" />
        </div>
      </div>
    );
  })}
</div>

      {/* Legend */}
      <div className="border-t border-slate-800 px-4 py-3 text-[11px] text-slate-400">
        <div className="flex flex-wrap items-center gap-3">
          <span className="opacity-80">Legend:</span>
          <span>Blue = positive swap</span>
          <span>Orange = negative swap</span>
          <span>Gray = frozen (no change last 5 cycles)</span>
        </div>
      </div>
    </section>
  );
}

function SortButton({
  label,
  active,
  dir,
  onClick,
}: {
  label: SortKey;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5",
        active
          ? "border-slate-600 bg-slate-800 text-slate-200"
          : "border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800"
      )}
      title={`Sort by ${label}`}
    >
      <ArrowUpDown className="h-3.5 w-3.5" />
      <span className="capitalize">{label}</span>
      {active && <span className="uppercase text-[10px]">{dir}</span>}
    </button>
  );
}

function toggleSort(
  setSort: React.Dispatch<React.SetStateAction<SortState>>,
  sort: SortState,
  key: SortKey
) {
  setSort((prev) => {
    if (prev.key !== key) return { key, dir: "desc" } as SortState;
    return { key, dir: prev.dir === "desc" ? "asc" : "desc" } as SortState;
  });
}

function RowMenu({ ci, onInspect }: { ci: string; onInspect: () => void }) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onInspect}
        className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
        title={`Inspect ${ci} routes`}
      >
        <MoreHorizontal className="h-3.5 w-3.5" /> inspect
      </button>
    </div>
  );
}
