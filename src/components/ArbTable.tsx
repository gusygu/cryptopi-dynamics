// src/components/ArbTable.tsx
"use client";

// CryptoPi Dynamics — ArbTable (modular, data-agnostic)
// ---------------------------------------------------------------------
// • 3 path columns (Cb→Ci, Ci→Ca, Ca→Ci) + wallets strip
// • Metrics per column: benchm, id_pct (+swap pill), drv% (vTendency)
// • Personalized: excludes Ci == Ca|Cb, limit to top 5 (sorted by id_pct)
// • Swap pill: starts as 0 00:00 (frozen) at boot, updates on real flips
// • Tolerant metric keys; stable keys; deduped wallet chips; no UI deps

import React, {
  useMemo,
  useRef,
  useState,
  useEffect,
  useCallback,
} from "react";
import { ArrowUpDown } from "lucide-react";

/* ============================== Types ============================== */

export type SwapTag = {
  count: number; // absolute running count from backend
  direction: "up" | "down" | "frozen";
  changedAtIso?: string; // ISO timestamp of last flip, undefined = boot state
};

export type RowMetrics = {
  benchmark: number; // unitless
  id_pct: number; // ±
  vTendency?: number; // tendency score (drv%)
  inertia?: "low" | "neutral" | "high" | "frozen";
  swapTag: SwapTag;
};

type EdgeKey = "cb_ci" | "ci_ca" | "ca_ci";

export type ArbRow = {
  ci: string; // candidate coin
  // preferred (per-edge) structure:
  // cols: { cb_ci?: RowMetrics; ci_ca?: RowMetrics; ca_ci?: RowMetrics }
  cols?: Partial<Record<EdgeKey, Partial<RowMetrics>>>;
  // legacy flat metrics (used as fallback)
  metrics?: Partial<RowMetrics>;
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

/* =========================== Small primitives ========================== */
function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function Badge(
  props: React.PropsWithChildren<React.HTMLAttributes<HTMLSpanElement>>
) {
  const { className = "", children, ...rest } = props;
  return (
    <span
      {...rest}
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        className
      )}
    >
      {children}
    </span>
  );
}

const fmt = {
  num(n?: number, p = 4) {
    if (n === undefined || n === null || Number.isNaN(n)) return "—";
    return Number(n).toLocaleString(undefined, {
      minimumFractionDigits: Math.min(2, p),
      maximumFractionDigits: p,
    });
  },
};

/* ========================= tolerant accessors ========================= */

function hasEdgeData(row: ArbRow, edge: EdgeKey) {
  return !!row?.cols?.[edge];
}

function getEdgeMetrics(row: ArbRow, edge: EdgeKey): Partial<RowMetrics> | undefined {
  // explicit per-edge
  if (row?.cols?.[edge]) return row.cols[edge];

  // try common synonyms on per-edge bucket
  const alt1 = edge.replace("cb_ci", "cbToCi").replace("ci_ca", "ciToCa").replace("ca_ci", "caToCi");
  const alt2 = edge.replace("cb_ci", "CB_CI").replace("ci_ca", "CI_CA").replace("ca_ci", "CA_CI");
  const alt3 = edge.replace("cb_ci", "cb-ci").replace("ci_ca", "ci-ca").replace("ca_ci", "ca-ci");

  if ((row as any)?.cols?.[alt1]) return (row as any).cols[alt1];
  if ((row as any)?.cols?.[alt2]) return (row as any).cols[alt2];
  if ((row as any)?.cols?.[alt3]) return (row as any).cols[alt3];

  // sometimes edges are placed at top-level
  if ((row as any)[edge]) return (row as any)[edge];

  // final fallback: legacy flat metrics bucket
  return row?.metrics ?? {};
}

function pickNum(src: any, keys: string[]): number | undefined {
  if (!src || typeof src !== "object") return undefined;
  for (const k of keys) {
    const v = (src as any)[k];
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/* ========================== Wallet badges (Ci) ========================== */
function WalletsStrip({ wallets, coins }: { wallets?: Record<string, number>; coins: string[] }) {
  const seen = new Set<string>();
  const chips = (coins || [])
    .map((c) => c.toUpperCase())
    .filter((c) => {
      if (seen.has(c)) return false;
      seen.add(c);
      return true;
    })
    .map((c) => ({ coin: c, bal: Number((wallets ?? {})[c] ?? 0) }))
    .filter((x) => Number.isFinite(x.bal))
    .sort((a, b) => b.bal - a.bal)
    .slice(0, 6);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {chips.map((ch) => (
        <Badge
          key={ch.coin}
          className={cx(
            "border border-slate-800 bg-slate-950/40 text-slate-200",
            ch.bal > 0 ? "ring-1 ring-emerald-800/40" : "opacity-60"
          )}
          title={`${ch.coin} · ${fmt.num(ch.bal, 6)}`}
        >
          <span className="font-mono tabular-nums">{ch.coin}</span>
          <span className="font-mono tabular-nums opacity-70">{fmt.num(ch.bal, 6)}</span>
        </Badge>
      ))}
      {!chips.length && <span className="text-slate-500 text-xs">No wallet balances</span>}
    </div>
  );
}

/* ========================== Swap pill (boot reset) ========================= */
// start at 0 00:00, grey (frozen) at app boot; only change after first real tick
const NEUTRAL_TAG: SwapTag = { count: 0, direction: "frozen" };

function SwapPill({ tag }: { tag: SwapTag }) {
  const color =
    tag.direction === "up"
      ? "bg-blue-500/70 text-blue-50"
      : tag.direction === "down"
      ? "bg-orange-500/70 text-orange-50"
      : "bg-slate-700 text-slate-300";

  const hhmm = tag.changedAtIso
    ? new Date(tag.changedAtIso).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "00:00";

  return (
    <span className={cx("ml-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] tabular-nums", color)}>
      {`${String(Math.max(0, Math.round(tag.count))).padStart(2, "0")} ${hhmm}`}
    </span>
  );
}

/* =========================== Column blocks =========================== */

function CellPath({ left, right }: { left: string; right: string }) {
  return (
    <div
      className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2"
      title={`${left} to ${right}`}
    >
      <span className="text-sm font-medium text-slate-100">{left}</span>
      <span className="text-slate-500">→</span>
      <span className="text-sm font-medium text-slate-100">{right}</span>
    </div>
  );
}

function ColumnMetrics({
  m,
  bootNeutral,
  pillTag,
}: {
  m?: Partial<RowMetrics>;
  bootNeutral: boolean;
  pillTag?: SwapTag;
}) {
  const bm = pickNum(m, ["benchmark", "bm", "bench"]);
  const id = pickNum(m, ["id_pct", "id", "idpct", "idPct"]);
  const vt = pickNum(m, ["vTendency", "v_tendency", "vt", "tendency"]); // drv%

  const tag: SwapTag = bootNeutral
    ? NEUTRAL_TAG // 0 00:00, grey
    : pillTag
    ? pillTag
    : (m?.swapTag as SwapTag) ?? NEUTRAL_TAG;

  return (
    <div className="mt-2 grid gap-1 text-[11px] text-slate-300">
      <div className="flex items-center gap-2">
        <span className="opacity-70">benchm</span>
        <span className="tabular-nums">{fmt.num(bm, 4)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="opacity-70">id_pct</span>
        <span className="tabular-nums">{fmt.num(id, 5)}</span>
        <SwapPill tag={tag} />
      </div>
      <div className="flex items-center gap-2">
        <span className="opacity-70">drv%</span>
        <span className="tabular-nums">{fmt.num(vt, 5)}</span>
      </div>
    </div>
  );
}

function ColBlock({
  ci,
  edge,
  left,
  right,
  m,
  bootNeutral,
  makeTag,
}: {
  ci: string;
  edge: EdgeKey;
  left: string;
  right: string;
  m?: Partial<RowMetrics>;
  bootNeutral: boolean;
  makeTag: (ci: string, edge: EdgeKey, tag?: SwapTag) => SwapTag;
}) {
  const pillTag = makeTag(ci, edge, m?.swapTag as SwapTag | undefined);
  return (
    <div className="col-span-3">
      <CellPath left={left} right={right} />
      <ColumnMetrics m={m} bootNeutral={bootNeutral} pillTag={pillTag} />
    </div>
  );
}

/* ============================== Sorting ============================== */
type SortKey = "symbol" | "id_pct" | "benchmark";
type SortState = { key: SortKey; dir: "asc" | "desc" };

function edgeForSort(row: ArbRow) {
  // prefer Ca→Ci, then Cb→Ci, then Ci→Ca; fall back to legacy
  return (
    getEdgeMetrics(row, "ca_ci") ??
    getEdgeMetrics(row, "cb_ci") ??
    getEdgeMetrics(row, "ci_ca") ??
    row?.metrics ??
    {}
  );
}

function sortRows(rows: ArbRow[], state: SortState): ArbRow[] {
  const { key, dir } = state;
  const sgn = dir === "asc" ? 1 : -1;

  const stable = rows.map((r, i) => ({ r, i }));
  stable.sort((a, b) => {
    if (key === "symbol") {
      const sa = String(a.r?.ci ?? "");
      const sb = String(b.r?.ci ?? "");
      const cmp = sa.localeCompare(sb);
      return cmp !== 0 ? cmp * sgn : a.i - b.i;
    }
    const ea = edgeForSort(a.r);
    const eb = edgeForSort(b.r);
    const va =
      key === "id_pct"
        ? pickNum(ea, ["id_pct", "id", "idpct", "idPct"]) ?? 0
        : pickNum(ea, ["benchmark", "bm", "bench"]) ?? 0;
    const vb =
      key === "id_pct"
        ? pickNum(eb, ["id_pct", "id", "idpct", "idPct"]) ?? 0
        : pickNum(eb, ["benchmark", "bm", "bench"]) ?? 0;

    return (va - vb) * sgn || a.i - b.i;
  });

  return stable.map((x) => x.r);
}

/* =============================== Component =============================== */
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
  // Personalized: exclude ci === Ca or ci === Cb
  const filtered = useMemo(
    () =>
      (rows ?? []).filter((r) => {
        const U = String(r?.ci || "").toUpperCase();
        return U && U !== String(Ca).toUpperCase() && U !== String(Cb).toUpperCase();
      }),
    [rows, Ca, Cb]
  );

  // sorting
  const [sort, setSort] = useState<SortState>(defaultSort);
  const sorted = useMemo(() => sortRows(filtered, sort), [filtered, sort]);

  // boot-neutral swap pills: freeze (0 00:00) until first observable change
  const baselinesRef = useRef<Record<string, number>>({});
  const [bootNeutral, setBootNeutral] = useState(true);

  const makeTag = useCallback(
    (ci: string, edge: EdgeKey, tag?: SwapTag): SwapTag => {
      const key = `${ci}|${edge}`;
      const baseline = baselinesRef.current;
      const orig = Number(tag?.count ?? 0);
      if (!(key in baseline)) baseline[key] = orig; // snapshot first time we see it
      const normalized = Math.max(0, orig - baseline[key]);
      return {
        count: normalized,
        direction: tag?.direction ?? "frozen",
        changedAtIso: tag?.changedAtIso, // will be undefined at boot → 00:00
      };
    },
    []
  );

  // detect first meaningful change (any swapTag diff) to unfreeze pills
  const sig = useMemo(() => {
    try {
      return JSON.stringify(
        sorted.map((r) => ({
          ci: r.ci,
          cb: (getEdgeMetrics(r, "cb_ci") as any)?.swapTag,
          ca: (getEdgeMetrics(r, "ca_ci") as any)?.swapTag,
          ic: (getEdgeMetrics(r, "ci_ca") as any)?.swapTag,
        }))
      );
    } catch {
      return "x";
    }
  }, [sorted]);

  useEffect(() => {
    if (!bootNeutral) return;
    // if any tag changes against snapshot, unfreeze
    setBootNeutral(false);
  }, [sig, bootNeutral]);

  // show all combinations in arb path (no top-5 cap)
  const topRows = sorted;

  return (
    <div className={cx("rounded-2xl border border-slate-800 bg-slate-900/60 p-4", className)}>
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-200">ArbTable</h3>
          <Badge className="border border-slate-700/60 bg-slate-950/40 text-slate-300">
            {String(Cb).toUpperCase()} / {String(Ca).toUpperCase()}
          </Badge>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span>{candidates.length} candidates</span>
          <button
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 hover:bg-slate-800/60"
            onClick={() =>
              setSort((s) => ({
                key: s.key === "id_pct" ? "benchmark" : "id_pct",
                dir: s.dir,
              }))
            }
            title="Toggle sort key (id_pct/benchmark)"
          >
            <ArrowUpDown size={14} />
            <span className="font-mono">sort: {sort.key}</span>
          </button>
          <button
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 hover:bg-slate-800/60"
            onClick={() =>
              setSort((s) => ({
                key: s.key,
                dir: s.dir === "asc" ? "desc" : "asc",
              }))
            }
            title="Toggle sort direction"
          >
            <ArrowUpDown size={14} />
            <span className="font-mono">dir: {sort.dir}</span>
          </button>
        </div>
      </header>

      {/* wallets strip */}
      <div className="mb-3">
        <WalletsStrip wallets={wallets} coins={[...new Set([Cb, Ca, ...candidates])]} />
      </div>

      {/* table */}
      <div className="grid gap-3">
        {topRows.map((r) => {
          const ci = String(r.ci).toUpperCase();
          const cb_ci = getEdgeMetrics(r, "cb_ci");
          const ci_ca = getEdgeMetrics(r, "ci_ca");
          const ca_ci = getEdgeMetrics(r, "ca_ci");

          return (
            <div
              key={ci}
              className={cx(
                "grid grid-cols-12 gap-3 rounded-xl border border-slate-800 bg-slate-950/30 p-3 hover:bg-slate-900/50",
                "transition-colors"
              )}
              onClick={() => onRowClick?.(ci)}
            >
              <div className="col-span-12 md:col-span-2 flex items-center gap-2">
                <Badge className="border border-slate-700/60 bg-slate-900/60 text-slate-200">
                  <span className="font-mono">{ci}</span>
                </Badge>
              </div>

              {/* Three path columns */}
              <ColBlock
                ci={ci}
                edge="cb_ci"
                left={Cb}
                right={ci}
                m={cb_ci}
                bootNeutral={bootNeutral}
                makeTag={makeTag}
              />
              <ColBlock
                ci={ci}
                edge="ci_ca"
                left={ci}
                right={Ca}
                m={ci_ca}
                bootNeutral={bootNeutral}
                makeTag={makeTag}
              />
              <ColBlock
                ci={ci}
                edge="ca_ci"
                left={Ca}
                right={ci}
                m={ca_ci}
                bootNeutral={bootNeutral}
                makeTag={makeTag}
              />
            </div>
          );
        })}

        {!topRows.length && !loading && (
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-400">
            No candidates.
          </div>
        )}
        {loading && (
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-400">
            Loading…
          </div>
        )}
      </div>
    </div>
  );
}
