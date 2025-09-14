"use client";

// /src/app/dynamics/ArbTable.tsx — CryptoPi Dynamics (finalized repatch)
// ---------------------------------------------------------------------
// • 3 path columns (Cb→Ci, Ci→Ca, Ca→Ci) + wallets strip
// • Metrics per column: bm, id_pct (+swap pill), vTendency
// • Personalized: excludes Ci == Ca|Cb, limit to top 5
// • Swap pill: starts as 0 00:00 (frozen) at boot, updates on real flips
// • Tolerant metric keys; stable keys; deduped wallet chips; no UI deps

import React, {
  useMemo,
  useRef,
  useState,
  useEffect,
  useCallback,
  type JSX,
} from "react";
import { ArrowUpDown } from "lucide-react";

/* ================================ Types ================================ */
export type SwapDirection = "up" | "down" | "frozen";

export type SwapTag = {
  count: number;
  direction: SwapDirection;
  changedAtIso?: string;
};

export type RowMetrics = {
  benchmark: number; // unitless
  id_pct: number; // ±%
  vTendency?: number; // tendency score
  inertia?: "low" | "neutral" | "high" | "frozen";
  swapTag: SwapTag;
};

type EdgeKey = "cb_ci" | "ci_ca" | "ca_ci";

export type ArbRow = {
  ci: string; // candidate coin
  // per-edge metrics (preferred)
  cols?: Partial<Record<EdgeKey, Partial<RowMetrics>>>;
  // legacy flat metrics bucket (fallback)
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
): JSX.Element {
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

function getEdgeMetrics(row: any, edge: EdgeKey) {
  const c = row?.cols ?? {};
  // try canonical first
  if (c && c[edge]) return c[edge];

  // tolerate alternate casings/keys
  const alt1 = edge.replace(/_/g, "");   // cbci
  const alt2 = edge.toUpperCase();       // CB_CI
  const alt3 = edge.replace(/_/g, "-");  // cb-ci

  if (c) {
    if (c[alt1]) return c[alt1];
    if (c[alt2]) return c[alt2];
    if (c[alt3]) return c[alt3];
  }

  // sometimes edges are placed at top-level
  if (row[edge]) return row[edge];
  if (row[alt1]) return row[alt1];
  if (row[alt2]) return row[alt2];
  if (row[alt3]) return row[alt3];

  // final fallback: legacy flat metrics
  return row?.metrics ?? {};
}



/* ====================== tolerant metric lookups ======================= */
function pickNum(src: any, keys: string[]): number | undefined {
  if (!src || typeof src !== "object") return undefined;
  for (const k of keys) {
    const v = (src as any)[k];
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function hasAnyMetric(src: any): boolean {
  return (
    pickNum(src, ["id_pct", "id", "idpct", "idPct"]) !== undefined ||
    pickNum(src, ["benchmark", "bm", "bench"]) !== undefined ||
    pickNum(src, ["vTendency", "v_tendency", "vt", "tendency"]) !== undefined
  );
}

function bestMetrics(edgeMaybe: any, legacyMaybe: any): any {
  if (hasAnyMetric(edgeMaybe)) return edgeMaybe;
  if (hasAnyMetric(legacyMaybe)) return legacyMaybe;
  return edgeMaybe ?? legacyMaybe ?? {};
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
        hour12: false,
      })
    : "00:00"; // boot default

  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5",
        color
      )}
      title={
        tag.changedAtIso
          ? `last flip at ${new Date(tag.changedAtIso).toLocaleString()}`
          : "no recent flips"
      }
    >
      <span className="text-[10px] leading-none font-mono tabular-nums">
        {tag.count}
      </span>
      <span className="text-[10px] leading-none font-mono tabular-nums">
        {hhmm}
      </span>
    </span>
  );
}

/* ================================ Wallets ================================ */
type WalletStripProps = {
  Ca?: string;
  Cb?: string;
  Ci?: string;
  wallets: Record<string, number>;
};

const up = (s?: string) => (s || "").toUpperCase();

/** Unique, stable chips (no duplicate/empty keys) */
function WalletStrip({ Ca, Cb, Ci, wallets }: WalletStripProps) {
  const raw = [up(Ca), up(Cb), up(Ci), "USDT"];
  const uniq = Array.from(new Set(raw.filter(Boolean)));

  const items = uniq.map((sym) => ({
    sym,
    amt: Number(wallets?.[sym] ?? 0),
  }));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map(({ sym, amt }, idx) => (
        <Badge
          key={`${sym}-${idx}`}
          className="bg-slate-700/40 text-slate-200 ring-1 ring-inset ring-slate-600/60"
        >
          <span className="font-mono">{sym}</span>
          <span className="tabular-nums">{amt.toFixed(3)}</span>
        </Badge>
      ))}
    </div>
  );
}

/* ===================== Path + per-edge metrics block ===================== */
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
  const vt = pickNum(m, ["vTendency", "v_tendency", "vt", "tendency"]);

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
        <span className="tabular-nums">{fmt.num(id, 6)}</span>
        <SwapPill tag={tag} />
      </div>
      <div className="flex items-center gap-2">
        <span className="opacity-70">drv%</span>
        <span className="tabular-nums">{fmt.num(vt, 4)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="opacity-70">extra</span>
        <span className="tabular-nums">—</span>
      </div>
    </div>
  );
}

/* ================================ Sorting ================================ */
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
    const cmp = va - vb;
    return cmp !== 0 ? cmp * sgn : a.i - b.i;
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
        const ci = (r?.ci || "").toUpperCase();
        const A = (Ca || "").toUpperCase();
        const B = (Cb || "").toUpperCase();
        return ci !== A && ci !== B;
      }),
    [rows, Ca, Cb]
  );

  // Sort + cap to 5
  const [sort, setSort] = useState<SortState>(defaultSort);
  const sorted = useMemo(
    () => sortRows(filtered, sort).slice(0, 5),
    [filtered, sort]
  );

  // boot-neutral logic for swap pills: show neutral until the first data tick
  const [postBootTick, setPostBootTick] = useState(false);
  const prevSig = useRef<string | null>(null);

  // per-edge baseline counts captured at boot to reset pill counters
  const baselinesRef = useRef<Record<string, number>>({});

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
          cb: r.cols?.cb_ci?.swapTag,
          ci_ca: r.cols?.ci_ca?.swapTag,
          ca_ci: r.cols?.ca_ci?.swapTag,
          lg: r.metrics?.swapTag,
        }))
      );
    } catch {
      return String(sorted.length);
    }
  }, [sorted]);

  useEffect(() => {
    if (prevSig.current === null) {
      prevSig.current = sig;
    } else if (prevSig.current !== sig) {
      setPostBootTick(true);
      prevSig.current = sig;
    }
  }, [sig]);

  return (
    <div className={cx("rounded-2xl border border-slate-800 bg-slate-900/60 p-3", className)}>
      {/* header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-200">Arbitrage candidates</div>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-xs"
            onClick={() =>
              setSort((s) =>
                s.key === "id_pct"
                  ? { key: "id_pct", dir: s.dir === "asc" ? "desc" : "asc" }
                  : { key: "id_pct", dir: "desc" }
              )
            }
            title="Sort by id_pct"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            id_pct
          </button>
          <button
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-xs"
            onClick={() =>
              setSort((s) =>
                s.key === "benchmark"
                  ? { key: "benchmark", dir: s.dir === "asc" ? "desc" : "asc" }
                  : { key: "benchmark", dir: "desc" }
              )
            }
            title="Sort by benchmark"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            benchmark
          </button>
          <button
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-xs"
            onClick={() =>
              setSort((s) =>
                s.key === "symbol"
                  ? { key: "symbol", dir: s.dir === "asc" ? "desc" : "asc" }
                  : { key: "symbol", dir: "asc" }
              )
            }
            title="Sort by symbol"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            symbol
          </button>
        </div>
      </div>

      {/* table header */}
      <div className="grid grid-cols-12 gap-2 text-[11px] text-slate-400 mb-2">
        <div className="col-span-2">symbol</div>
        <div className="col-span-3">Cb → Ci</div>
        <div className="col-span-3">Ci → Ca</div>
        <div className="col-span-3">Ca → Ci</div>
        <div className="col-span-1 text-right">wallets</div>
      </div>

      {/* rows */}
      <div className="space-y-2">
        {sorted.map((row, idx) => {
          const ci = row.ci;
          // AFTER
          const m_cb_ci = getEdgeMetrics(row, "cb_ci");
          const m_ci_ca = getEdgeMetrics(row, "ci_ca");
          const m_ca_ci = getEdgeMetrics(row, "ca_ci");


          return (
            <div
              key={`${ci}-${idx}`}
              className="grid grid-cols-12 gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-2 hover:bg-slate-900/60"
              onClick={() => onRowClick?.(ci)}
              role="button"
              tabIndex={0}
            >
              {/* symbol */}
              <div className="col-span-2 flex items-center gap-2">
                <span className="text-sm font-medium text-slate-100">{ci}</span>
              </div>

              {/* Cb → Ci */}
              <ColBlock
                ci={ci}
                edge="cb_ci"
                left={Cb}
                right={ci}
                m={m_cb_ci}
                bootNeutral={!postBootTick}
                makeTag={makeTag}
              />

              {/* Ci → Ca */}
              <ColBlock
                ci={ci}
                edge="ci_ca"
                left={ci}
                right={Ca}
                m={m_ci_ca}
                bootNeutral={!postBootTick}
                makeTag={makeTag}
              />

              {/* Ca → Ci */}
              <ColBlock
                ci={ci}
                edge="ca_ci"
                left={Ca}
                right={ci}
                m={m_ca_ci}
                bootNeutral={!postBootTick}
                makeTag={makeTag}
              />

              {/* wallets */}
              <div className="col-span-1 flex items-center justify-end">
                <WalletStrip Ca={Ca} Cb={Cb} Ci={ci} wallets={wallets} />
              </div>
            </div>
          );
        })}

        {!sorted.length && !loading && (
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
