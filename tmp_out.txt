// src/components/AssetsIdentity.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
      // other fields omitted
    }
  >;
};

export type AssetsIdentityProps = {
  base: string; // e.g. "BTC"
  quote: string; // e.g. "ETH"
  wallets?: Record<string, number>; // optional: { BTC: 0.42, ETH: 1.1, USDT: 25.5 }
  autoRefreshMs?: number; // optional polling
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
  const abortRef = useRef<AbortController | null>(null);

  const fmt = {
    bench: (v: number | null) =>
      v == null || !Number.isFinite(v) ? "—" : Number(v).toFixed(4),
    id: (v: number | null) =>
      v == null || !Number.isFinite(v) ? "—" : Number(v).toFixed(6),
    pct: (v: number | null) =>
      v == null || !Number.isFinite(v) ? "—" : `${Number(v).toFixed(4)}%`,
    bal: (v?: number) =>
      v == null || !Number.isFinite(v) ? "—" : Number(v).toFixed(3),
  };

  const fetchAll = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setErr(null);
    try {
      // 1) matrices/latest for B,Q,USDT
      const u1 = new URL("/api/matrices/latest", window.location.origin);
      u1.searchParams.set("coins", [B, Q, U].join(","));
      u1.searchParams.set("t", String(Date.now()));
      const r1 = await fetch(u1, { cache: "no-store", signal: ac.signal });
      if (!r1.ok) throw new Error(`latest HTTP ${r1.status}`);
      const j1 = (await r1.json()) as MatricesResp;

      const coins = (j1?.coins || []).map((s) => String(s).toUpperCase());
      const iB = coins.indexOf(B);
      const iQ = coins.indexOf(Q);
      const iU = coins.indexOf(U);

      const M = (g?: Grid) => (Array.isArray(g) ? g : undefined);
      const bench = M(j1?.matrices?.benchmark);
      const id = M(j1?.matrices?.id_pct);
      const pct = M(j1?.matrices?.pct24h);

      const pick = (g: Grid | undefined, i: number, j: number): number | null =>
        g && Number.isFinite(Number(g?.[i]?.[j])) ? Number(g[i][j]) : null;

      // A/B
      setBenchAB(iB >= 0 && iQ >= 0 ? pick(bench, iB, iQ) : null);
      setIdAB(iB >= 0 && iQ >= 0 ? pick(id, iB, iQ) : null);
      setPctAB(iB >= 0 && iQ >= 0 ? pick(pct, iB, iQ) : null);

      // A/USDT and Q/USDT
      setBenchAU(iB >= 0 && iU >= 0 ? pick(bench, iB, iU) : B === U ? 1 : null);
      setIdAU(iB >= 0 && iU >= 0 ? pick(id, iB, iU) : B === U ? 0 : null);

      setBenchQU(iQ >= 0 && iU >= 0 ? pick(bench, iQ, iU) : Q === U ? 1 : null);
      setIdQU(iQ >= 0 && iU >= 0 ? pick(id, iQ, iU) : Q === U ? 0 : null);

      // 2) str-aux/bins for histogram (A/B)
      const sym = `${B}${Q}`;
      const u2 = new URL("/api/str-aux/bins", window.location.origin);
      u2.searchParams.set("pairs", sym);
      u2.searchParams.set("window", "30m");
      u2.searchParams.set("bins", "128");
      u2.searchParams.set("sessionId", "dyn");
      u2.searchParams.set("t", String(Date.now()));
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
      if (e?.name !== "AbortError") {
        setErr(String(e?.message || e));
      }
    } finally {
      setLoading(false);
    }
  }, [B, Q]);

  useEffect(() => {
    fetchAll();
    return () => abortRef.current?.abort();
  }, [fetchAll]);

  useEffect(() => {
    if (!autoRefreshMs || autoRefreshMs < 5_000) return;
    const id = setInterval(fetchAll, autoRefreshMs);
    return () => clearInterval(id);
  }, [autoRefreshMs, fetchAll]);

  const since = useMemo(() => {
    if (!tstamp) return "—";
    const sec = Math.max(0, Math.round((Date.now() - tstamp) / 1000));
    return `${sec}s`;
  }, [tstamp]);

  return (
    <div
      className={[
        "rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm shadow-lg p-4",
        className,
      ].join(" ")}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PairChip base={B} quote={Q} />
          <ValueChip label="benchm" value={fmt.bench(benchAB)} tone="neutral" />
          <ValueChip label="id_pct" value={fmt.id(idAB)} tone={toneFromNumber(idAB)} />
          <ValueChip label="pct24h" value={fmt.pct(pctAB)} tone={toneFromNumber(pctAB)} />
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span>updated {since} ago</span>
          <button
            className="rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800/60"
            onClick={fetchAll}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="mt-3 grid grid-cols-12 gap-4">
        {/* Bridges */}
        <div className="col-span-12 lg:col-span-5 rounded-xl border border-slate-800 bg-slate-950/30 p-3">
          <h4 className="mb-2 text-xs font-semibold text-slate-300">USDT Bridges</h4>
          <div className="grid grid-cols-2 gap-3">
            <BridgeCard coin={B} bench={benchAU} id={idAU} />
            <BridgeCard coin={Q} bench={benchQU} id={idQU} />
          </div>

          {/* C1↔C2 quick refs */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <QuickRef
              title={`${B} → ${Q}`}
              bench={benchAB}
              id={idAB}
            />
            <QuickRef
              title={`${Q} → ${B}`}
              bench={invertSafe(benchAB)}
              id={invertIdPct(idAB)}
            />
          </div>
        </div>

        {/* Wallets */}
        <div className="col-span-12 lg:col-span-3 rounded-xl border border-slate-800 bg-slate-950/30 p-3">
          <h4 className="mb-2 text-xs font-semibold text-slate-300">Wallet</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-2">
            <WalletCard coin={B} balance={wallets?.[B]} />
            <WalletCard coin={Q} balance={wallets?.[Q]} />
            <WalletCard coin={U} balance={wallets?.[U]} />
          </div>
          {err && (
            <div className="mt-2 text-[11px] text-rose-300">Error: {err}</div>
          )}
        </div>

        {/* Histogram */}
        <div className="col-span-12 lg:col-span-4 rounded-xl border border-slate-800 bg-slate-950/30 p-3">
          <h4 className="mb-2 text-xs font-semibold text-slate-300">
            Histogram (IDHR bins · {B}/{Q})
          </h4>
          <Histogram counts={hist} />
          <div className="mt-2 text-[10px] text-slate-500">
            Bars derived from <code>/api/str-aux/bins</code> (window 30m · bins 128).
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────── Small UI bits ────────────────────────── */

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
    <span
      className={[
        "inline-flex items-center gap-1 rounded-xl border px-2.5 py-1 text-xs",
        map[tone],
      ].join(" ")}
    >
      <span className="opacity-70">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </span>
  );
}

function toneFromNumber(v: number | null): "neutral" | "pos" | "neg" | "amber" {
  if (v == null || !Number.isFinite(v)) return "neutral";
  if (v === 0) return "amber";
  return v > 0 ? "pos" : "neg";
}

function BridgeCard({ coin, bench, id }: { coin: string; bench: number | null; id: number | null }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
      <div className="text-xs text-slate-400 mb-1">{coin} → USDT</div>
      <div className="flex items-center gap-3">
        <BadgeKV k="benchm" v={bench} fmt="bench" />
        <BadgeKV k="id_pct" v={id} fmt="id" />
      </div>
    </div>
  );
}

function QuickRef({ title, bench, id }: { title: string; bench: number | null; id: number | null }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
      <div className="text-xs text-slate-400 mb-1">{title}</div>
      <div className="flex items-center gap-3">
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
  // For small id_pct, the approximate inverse delta is ~ -id_pct, keep simple:
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
    <span className={["inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]", chip].join(" ")}>
      <span className="opacity-70">{k}</span>
      <span className="font-mono tabular-nums">{format(v)}</span>
    </span>
  );
}

function WalletCard({ coin, balance }: { coin: string; balance?: number }) {
  const has = Number.isFinite(Number(balance)) && Number(balance) !== 0;
  return (
    <div
      className={[
        "rounded-md border px-3 py-2",
        has
          ? "border-emerald-800/50 bg-emerald-950/20 text-emerald-200"
          : "border-slate-800 bg-slate-900/50 text-slate-300",
      ].join(" ")}
      title={has ? `${coin} • ${Number(balance).toFixed(6)}` : "no balance"}
    >
      <div className="text-[11px] text-slate-400">{coin}</div>
      <div className="font-mono tabular-nums text-sm">
        {Number.isFinite(Number(balance)) ? Number(balance).toFixed(6) : "—"}
      </div>
    </div>
  );
}

/* ─────────────────────────── Tiny Histogram ─────────────────────────── */

function Histogram({ counts }: { counts: number[] }) {
  const W = 320;
  const H = 72;
  const pad = 6;

  const data = Array.isArray(counts) ? counts.filter((n) => Number.isFinite(Number(n))).map(Number) : [];
  const n = data.length;
  const max = data.reduce((m, v) => (v > m ? v : m), 0);

  if (!n || max <= 0) {
    return (
      <div className="h-[88px] rounded-md border border-slate-800 bg-slate-900/50 flex items-center justify-center text-slate-500 text-sm">
        No histogram data.
      </div>
    );
  }

  const bw = (W - pad * 2) / n;
  const scaleY = (v: number) => Math.round((H - pad * 2) * (v / max));

  return (
    <div className="overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[88px] rounded-md border border-slate-800 bg-slate-900/50">
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
