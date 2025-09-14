// src/components/AssetsIdentity.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePreviewSymbols, useDomainVM } from "@/lib/dynamicsClient";
import { subscribe } from "@/lib/pollerClient";

type Grid = (number | null)[][];
type MatricesResp = {
  ok: boolean;
  coins: string[];
  matrices: Partial<{ benchmark: Grid; id_pct: Grid; pct24h: Grid }>;
  ts?: Record<string, number>;
};
type StrBinsResp = {
  ok: boolean;
  ts?: number;
  symbols?: string[];
  out?: Record<
    string,
    {
      ok?: boolean;
      lastUpdateTs?: number;
      hist?: { counts?: number[] };
    }
  >;
};

export type AssetsIdentityProps = {
  base: string;
  quote: string;
  wallets?: Record<string, number>;
  autoRefreshMs?: number;
  className?: string;
};

export default function AssetsIdentity({
  base,
  quote,
  wallets,
  autoRefreshMs = 0,
  className = "",
}: AssetsIdentityProps) {
  const B = String(base).toUpperCase();
  const Q = String(quote).toUpperCase();
  const U = "USDT";

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tstamp, setTstamp] = useState<number | null>(null);

  const [benchAB, setBenchAB] = useState<number | null>(null);
  const [idAB, setIdAB] = useState<number | null>(null);
  const [pctAB, setPctAB] = useState<number | null>(null);

  const [benchAU, setBenchAU] = useState<number | null>(null);
  const [idAU, setIdAU] = useState<number | null>(null);

  const [benchQU, setBenchQU] = useState<number | null>(null);
  const [idQU, setIdQU] = useState<number | null>(null);

  const [hist, setHist] = useState<number[]>([]);
  const [wal, setWal] = useState<Record<string, number>>({});
  const abortRef = useRef<AbortController | null>(null);
  const { symbols: previewSyms } = usePreviewSymbols();
  const previewHas = useMemo(() => {
    const s = new Set(previewSyms.map((x) => String(x || "").toUpperCase()));
    return (A: string, B: string) => s.has(`${A}${B}`.toUpperCase());
  }, [previewSyms]);

  const fmt = {
    bench: (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : Number(v).toFixed(4)),
    id: (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : Number(v).toFixed(6)),
    pct: (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : `${Number(v).toFixed(4)}%`),
    bal: (v?: number) => (v == null || !Number.isFinite(v) ? "—" : Number(v).toFixed(3)),
  };

  const fetchAll = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setErr(null);
    try {
      // matrices/latest
      const u1 = new URL("/api/matrices/latest", window.location.origin);
      u1.searchParams.set("coins", [B, Q, U].join(","));
      const r1 = await fetch(u1, { cache: "no-store", signal: ac.signal });
      if (!r1.ok) throw new Error(`latest HTTP ${r1.status}`);
      const j1 = (await r1.json()) as MatricesResp;

      const coins = (j1?.coins || []).map((s) => String(s).toUpperCase());
      const iB = coins.indexOf(B), iQ = coins.indexOf(Q), iU = coins.indexOf(U);
      const M = (g?: Grid) => (Array.isArray(g) ? g : undefined);
      const bench = M(j1?.matrices?.benchmark);
      const id = M(j1?.matrices?.id_pct);
      const pct = M(j1?.matrices?.pct24h);
      const pick = (g: Grid | undefined, i: number, j: number): number | null =>
        g && Number.isFinite(Number(g?.[i]?.[j])) ? Number(g[i][j]) : null;

      setBenchAB(iB >= 0 && iQ >= 0 ? pick(bench, iB, iQ) : null);
      setIdAB(iB >= 0 && iQ >= 0 ? pick(id, iB, iQ) : null);
      setPctAB(iB >= 0 && iQ >= 0 ? pick(pct, iB, iQ) : null);

      setBenchAU(iB >= 0 && iU >= 0 ? pick(bench, iB, iU) : B === U ? 1 : null);
      setIdAU(iB >= 0 && iU >= 0 ? pick(id, iB, iU) : B === U ? 0 : null);
      setBenchQU(iQ >= 0 && iU >= 0 ? pick(bench, iQ, iU) : Q === U ? 1 : null);
      setIdQU(iQ >= 0 && iU >= 0 ? pick(id, iQ, iU) : Q === U ? 0 : null);

      // wallet balances
      try {
        const uWal = new URL("/api/providers/binance/wallet", window.location.origin);
        const rWal = await fetch(uWal, { cache: "no-store", signal: ac.signal });
        if (rWal.ok) {
          const jWal = (await rWal.json()) as { ok?: boolean; wallets?: Record<string, number> };
          if (jWal?.wallets) setWal(jWal.wallets);
        }
      } catch {}

      // str-aux/bins (hist)
      const sym = `${B}${Q}`;
      const u2 = new URL("/api/str-aux/bins", window.location.origin);
      u2.searchParams.set("pairs", sym);
      u2.searchParams.set("window", "30m");
      u2.searchParams.set("bins", "128");
      u2.searchParams.set("sessionId", "dyn");
      const r2 = await fetch(u2, { cache: "no-store", signal: ac.signal });
      if (r2.ok) {
        const j2 = (await r2.json()) as StrBinsResp;
        const o = j2?.out?.[sym];
        const counts = (o?.hist?.counts ?? []) as number[];
        if (Array.isArray(counts)) setHist(counts);
        setTstamp(Number(o?.lastUpdateTs ?? j2?.ts ?? Date.now()) || Date.now());
      } else {
        setHist([]);
        setTstamp(Date.now());
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [B, Q]);

  useEffect(() => {
    fetchAll();
    const unsub = subscribe((ev) => {
      if (ev.type === "tick40" || ev.type === "tick120" || ev.type === "refresh") {
        fetchAll();
      }
    });
    return () => { unsub(); abortRef.current?.abort(); };
  }, [fetchAll]);

  const since = useMemo(() => {
    if (!tstamp) return "—";
    const sec = Math.max(0, Math.round((Date.now() - tstamp) / 1000));
    return `${sec}s`;
  }, [tstamp]);

  // Converter VM (DB-backed) for pct_drv strokes series
  const { vm: convVm } = useDomainVM(B, Q, [B, Q], []);
  const drvSeries = useMemo(() =>
    (convVm as any)?.series?.pct_drv as number[] | undefined,
  [convVm]);

  return (
    <div className={["rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm shadow-lg p-4", className].join(" ")}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex flex-wrap items-center gap-2">
          <PairChip base={B} quote={Q} />
          <ValueChip label="benchm" value={fmt.bench(benchAB)} tone="neutral" />
          <ValueChip label="id_pct" value={fmt.id(idAB)} tone={toneFromNumber(idAB)} />
          <ValueChip label="pct24h" value={fmt.pct(pctAB)} tone={toneFromNumber(pctAB)} />
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span className="shrink-0">updated {since} ago</span>
          <button
            className="rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800/60"
            onClick={fetchAll}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Body: Bridges · Wallet · Histogram */}
      <div className="mt-3 grid grid-cols-12 gap-4">
        {/* Bridges */}
        <section className="col-span-12 xl:col-span-5 rounded-xl border border-slate-800 bg-slate-950/30 p-3 min-w-0">
          <h4 className="mb-2 text-xs font-semibold text-slate-300">USDT Bridges</h4>

          <div className="grid grid-cols-2 gap-3 min-w-0">
            <BridgeRow title={`${B} → ${U}`} bench={benchAU} id={idAU} />
            <BridgeRow title={`${Q} → ${U}`} bench={benchQU} id={idQU} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 min-w-0">
            <QuickRef title={`${B} → ${Q}`} bench={benchAB} id={idAB} />
            <QuickRef title={`${Q} → ${B}`} bench={invertSafe(benchAB)} id={invertIdPct(idAB)} />
          </div>
        </section>

        {/* Wallet */}
        <section className="col-span-12 xl:col-span-3 rounded-xl border border-slate-800 bg-slate-950/30 p-3 min-w-0">
          <h4 className="mb-2 text-xs font-semibold text-slate-300">Wallet</h4>
          <div className="grid grid-cols-1 gap-2">
            <WalletLine coin={B} balance={(wallets ?? wal)?.[B]} />
            <WalletLine coin={Q} balance={(wallets ?? wal)?.[Q]} />
            <WalletLine coin={U} balance={(wallets ?? wal)?.[U]} />
          </div>
          {err && <div className="mt-2 text-[11px] text-rose-300 truncate">Error: {err}</div>}
        </section>

        {/* Histograms: pct_drv strokes + IDHR bins */}
        <section className="col-span-12 xl:col-span-4 rounded-xl border border-slate-800 bg-slate-950/30 p-3 min-w-0">
          <h4 className="mb-2 text-xs font-semibold text-slate-300">Histograms · {B}/{Q}</h4>

          {/* pct_drv stroke histogram (top) */}
          <div className="mb-2">
            <StrokeHistogram data={Array.isArray(drvSeries) ? drvSeries : []} height={70} />
            <div className="mt-1 flex items-center gap-4 text-[10px] text-slate-500">
              <LegendSwatch color="#84cc16" label="positive (up)" />
              <LegendSwatch color="#ef4444" label="negative (down)" />
              <LegendLine color="#334155" label="zero" />
            </div>
          </div>

          {/* IDHR bins (bottom) */}
          <Histogram counts={hist} />
          <div className="mt-1 flex items-center gap-4 text-[10px] text-slate-500">
            <LegendSwatch color="currentColor" label="bin magnitude" />
          </div>
        </section>
      </div>
    </div>
  );
}

/* ────────────── UI atoms (safe wrapping / no overflow) ────────────── */

function PairChip({ base, quote }: { base: string; quote: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-xl border border-emerald-800/40 bg-emerald-950/30 px-2.5 py-1 text-xs text-emerald-200 ring-1 ring-emerald-900/40">
      <span className="font-semibold">{base}</span>
      <span className="opacity-70">/</span>
      <span className="font-semibold">{quote}</span>
    </span>
  );
}
function ValueChip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "pos" | "neg" | "amber";
}) {
  const map = {
    neutral: "border-slate-700/60 bg-slate-900/60 text-slate-200",
    pos: "border-emerald-700/60 bg-emerald-950/30 text-emerald-200 ring-1 ring-emerald-800/40",
    neg: "border-rose-700/60 bg-rose-950/30 text-rose-200 ring-1 ring-rose-800/40",
    amber: "border-amber-700/60 bg-amber-950/30 text-amber-200 ring-1 ring-amber-800/40",
  } as const;
  return (
    <span className={["inline-flex items-center gap-1 rounded-xl border px-2.5 py-1 text-xs min-w-0", map[tone]].join(" ")}>
      <span className="opacity-70">{label}</span>
      <span className="font-mono tabular-nums max-w-[9rem] truncate">{value}</span>
    </span>
  );
}
function toneFromNumber(v: number | null): "neutral" | "pos" | "neg" | "amber" {
  if (v == null || !Number.isFinite(v)) return "neutral";
  if (v === 0) return "amber";
  return v > 0 ? "pos" : "neg";
}

/** One-line bridge row with safe wrapping. */
function BridgeRow({ title, bench, id }: { title: string; bench: number | null; id: number | null }) {
  const { symbols } = usePreviewSymbols();
  const set = useMemo(() => new Set(symbols.map((s) => String(s || "").toUpperCase())), [symbols]);
  const toks = (title.match(/[A-Z0-9]+/g) || []) as string[];
  const A = String(toks[0] || "").toUpperCase();
  const B = String(toks[toks.length - 1] || "").toUpperCase();
  const preview = A && B ? (set.has(`${A}${B}`) || set.has(`${B}${A}`)) : false;
  return (
    <div
      className={[
        "rounded-lg border bg-slate-900/50 p-3 min-w-0",
        preview
          ? "border-emerald-800/60 ring-2 ring-emerald-400/70 shadow-[0_0_0_2px_rgba(52,211,153,0.2)]"
          : "border-slate-800",
      ].join(" ")}
      title={preview ? `${A}/${B} preview available` : `${A}/${B} not in preview`}
    >
      <div className="text-xs text-slate-400 mb-1 truncate">{title}</div>
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <BadgeKV k="benchm" v={bench} fmt="bench" />
        <BadgeKV k="id_pct" v={id} fmt="id" />
      </div>
    </div>
  );
}
function QuickRef({ title, bench, id }: { title: string; bench: number | null; id: number | null }) {
  const { symbols } = usePreviewSymbols();
  const set = useMemo(() => new Set(symbols.map((s) => String(s || "").toUpperCase())), [symbols]);
  const toks = (title.match(/[A-Z0-9]+/g) || []) as string[];
  const A = String(toks[0] || "").toUpperCase();
  const B = String(toks[toks.length - 1] || "").toUpperCase();
  const preview = A && B ? (set.has(`${A}${B}`) || set.has(`${B}${A}`)) : false;
  return (
    <div
      className={[
        "rounded-lg border bg-slate-900/50 p-3 min-w-0",
        preview
          ? "border-emerald-800/60 ring-2 ring-emerald-400/70 shadow-[0_0_0_2px_rgba(52,211,153,0.2)]"
          : "border-slate-800",
      ].join(" ")}
      title={preview ? `${A}/${B} preview available` : `${A}/${B} not in preview`}
    >
      <div className="text-xs text-slate-400 mb-1 truncate">{title}</div>
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <BadgeKV k="benchm" v={bench} fmt="bench" />
        <BadgeKV k="id_pct" v={id} fmt="id" />
      </div>
    </div>
  );
}

function invertSafe(v: number | null) {
  if (v == null || !Number.isFinite(v) || v === 0) return null;
  return 1 / v;
}
function invertIdPct(v: number | null) {
  if (v == null || !Number.isFinite(v)) return null;
  return -v;
}

function BadgeKV({
  k,
  v,
  fmt: which,
}: {
  k: string;
  v: number | null;
  fmt: "bench" | "id" | "pct";
}) {
  const format =
    which === "bench" ? (x: number | null) => (x == null ? "—" : x.toFixed(4)) :
    which === "id"    ? (x: number | null) => (x == null ? "—" : x.toFixed(6)) :
                        (x: number | null) => (x == null ? "—" : `${x.toFixed(4)}%`);

  const tone = toneFromNumber(v);
  const chip =
    tone === "pos"
      ? "border-emerald-700/60 bg-emerald-950/30 text-emerald-200 ring-1 ring-emerald-800/40"
      : tone === "neg"
      ? "border-rose-700/60 bg-rose-950/30 text-rose-200 ring-1 ring-rose-800/40"
      : tone === "amber"
      ? "border-amber-700/60 bg-amber-950/30 text-amber-200 ring-1 ring-amber-800/40"
      : "border-slate-700/60 bg-slate-900/60 text-slate-200";

  return (
    <span className={["inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] min-w-0", chip].join(" ")}>
      <span className="opacity-70">{k}</span>
      <span className="font-mono tabular-nums max-w-[7.5rem] truncate">{format(v)}</span>
    </span>
  );
}

function WalletLine({ coin, balance }: { coin: string; balance?: number }) {
  const has = Number.isFinite(Number(balance)) && Number(balance) !== 0;
  return (
    <div
      className={[
        "rounded-md border px-3 py-2 min-w-0",
        has
          ? "border-emerald-800/50 bg-emerald-950/20 text-emerald-200"
          : "border-slate-800 bg-slate-900/50 text-slate-300",
      ].join(" ")}
      title={has ? `${coin} • ${Number(balance).toFixed(6)}` : "no balance"}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-slate-400">{coin}</span>
        <span className="font-mono tabular-nums text-sm max-w-[10rem] truncate">
          {Number.isFinite(Number(balance)) ? Number(balance).toFixed(6) : "—"}
        </span>
      </div>
    </div>
  );
}

/* ─────────────────────── Compact histogram (stable) ─────────────────────── */

function Histogram({ counts }: { counts: number[] }) {
  const W = 320;
  const H = 90;
  const pad = 6;

  const data = Array.isArray(counts) ? counts.filter((n) => Number.isFinite(Number(n))).map(Number) : [];
  const n = data.length;
  const max = data.reduce((m, v) => (v > m ? v : m), 0);

  if (!n || max <= 0) {
    return (
      <div className="h-[96px] rounded-md border border-slate-800 bg-slate-900/50 flex items-center justify-center text-slate-500 text-sm">
        No histogram data.
      </div>
    );
  }

  const bw = (W - pad * 2) / n;
  const scaleY = (v: number) => Math.round((H - pad * 2) * (v / max));

  return (
    <div className="overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[96px] rounded-md border border-slate-800 bg-slate-900/50">
        {data.map((v, i) => {
          const h = scaleY(v);
          const x = pad + i * bw;
          const y = H - pad - h;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={Math.max(1, bw - 1)}
              height={Math.max(1, h)}
              rx={2}
              className="fill-emerald-600/60"
            />
          );
        })}
    </svg>
    </div>
  );
}

/* ───────────────────── Stroke histogram from pct_drv ───────────────────── */
function StrokeHistogram({ data, height = 70 }: { data: number[]; height?: number }) {
  const N = Array.isArray(data) ? data.length : 0;
  if (!N) {
    return (
      <div className="h-[70px] rounded-md border border-slate-800 bg-slate-900/50 flex items-center justify-center text-slate-500 text-xs">
        No pct_drv series.
      </div>
    );
  }
  const maxAbs = data.reduce((m, v) => Math.max(m, Math.abs(Number(v) || 0)), 1e-9);
  const baseline = Math.round(height / 2);
  const xStep = 100 / Math.max(1, N);
  const strokeW = Math.max(0.4, 100 / Math.max(160, N * 1.3));
  return (
    <div className={`w-full`}>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        <line x1="0" y1={baseline} x2="100" y2={baseline} stroke="#334155" strokeWidth="0.6" />
        {data.map((raw, k) => {
          const v = Number(raw) || 0;
          const mag = (Math.abs(v) / maxAbs) * (baseline - 4);
          const x = k * xStep + xStep / 2;
          const y1 = v >= 0 ? baseline - mag : baseline;
          const y2 = v >= 0 ? baseline : baseline + mag;
          const color = v >= 0 ? "#84cc16" : "#ef4444";
          return <line key={k} x1={x} y1={y1} x2={x} y2={y2} stroke={color} strokeWidth={strokeW} />;
        })}
      </svg>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </span>
  );
}
function LegendLine({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-block h-0.5 w-5" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </span>
  );
}
