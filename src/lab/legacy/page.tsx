"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import ArbTable from "@/app/dynamics/ArbTable";
import {
  useDomainVM,
  toArbTableInput,
  toMetricsPanel,
} from "@/converters/Converter.client";
import { useSettings } from "@/lib/settings/provider";

/* ───────────────────────────── Types ───────────────────────────── */

type Pair = { base: string; quote: string };

type MatricesResp = {
  ok: boolean;
  coins: string[];
  matrices: Partial<Record<"benchmark" | "id_pct" | "pct_drv", number[][]>>;
};

type MeaResp = { ok: boolean; grid?: number[][] };

type PreviewResp = { ok: boolean; symbols?: string[] };

type StrBinsResp = {
  ok: boolean;
  ts: number;
  symbols: string[];
  out: Record<
    string,
    {
      ok: boolean;
      gfmDelta?: { absPct?: number };
      shifts?: { nShifts: number; timelapseSec: number; latestTs: number };
      swaps?: number;
      fm?: { vInner?: number; vOuter?: number };
      lastUpdateTs?: number;
    }
  >;
};

declare global {
  interface Window {
    __CIN_MIRROR__?: Record<
      string,
      { session?: { imprint?: number; luggage?: number }; cycle?: { imprint?: number; luggage?: number } }
    >;
  }
}

/* ───────────────────────────── Utils ───────────────────────────── */

const ENV_FALLBACK = (process.env.NEXT_PUBLIC_COINS ??
  "BTC,ETH,BNB,SOL,ADA,XRP,PEPE,DOGE,USDT")
  .split(",")
  .map((s) => s.trim().toUpperCase());

const fmt = (x: number, d = 3) =>
  Number(x ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });

/** safe [i][j] */
function cell(
  g: number[][] | undefined,
  coins: string[] | undefined,
  a?: string,
  b?: string
): number | undefined {
  if (!g || !coins || !a || !b) return undefined;
  const i = coins.indexOf(a);
  const j = coins.indexOf(b);
  if (i < 0 || j < 0) return undefined;
  return g[i]?.[j];
}

/** greens/reds by id_pct with 4 steps, amber for zero, frozen dim */
function tailwindBandForValue(v?: number | null, frozen = false) {
  if (frozen) return "bg-amber-900/60 border-amber-600/50 text-amber-200";
  if (v == null) return "bg-slate-900 border-slate-800 text-slate-500";
  if (v === 0) return "bg-amber-900/30 border-amber-700/40 text-amber-200";

  const n = Number(v);
  const m = Math.abs(n);

  const pos = [
    "bg-emerald-900/20 text-emerald-200 border-emerald-800/25",
    "bg-emerald-900/35 text-emerald-200 border-emerald-800/40",
    "bg-emerald-900/55 text-emerald-100 border-emerald-800/60",
    "bg-emerald-900/75 text-emerald-100 border-emerald-800/80",
  ];
  const neg = [
    "bg-red-950/30 text-red-200 border-red-900/40",
    "bg-red-900/45 text-red-200 border-red-800/55",
    "bg-red-900/65 text-red-100 border-red-800/75",
    "bg-red-900/85 text-red-100 border-red-800/90",
  ];

  // tighter bands (id_pct is small)
  const idx = m > 0.003 ? 3 : m > 0.0012 ? 2 : m > 0.0004 ? 1 : 0;
  return n >= 0 ? pos[idx] : neg[idx];
}

async function fetchMatricesLatest(coins: string[], signal?: AbortSignal) {
  const url = new URL("/api/matrices/latest", window.location.origin);
  if (coins?.length) url.searchParams.set("coins", coins.join(","));
  url.searchParams.set("t", String(Date.now()));
  const r = await fetch(url, { cache: "no-store", signal });
  if (!r.ok) throw new Error(`matrices HTTP ${r.status}`);
  return (await r.json()) as MatricesResp;
}
async function fetchMeaGrid(coins: string[], signal?: AbortSignal) {
  const url = new URL("/api/mea-aux", window.location.origin);
  if (coins?.length) url.searchParams.set("coins", coins.join(","));
  url.searchParams.set("t", String(Date.now()));
  try {
    const r = await fetch(url, { cache: "no-store", signal });
    if (!r.ok) return undefined;
    const j = (await r.json()) as MeaResp;
    return j?.grid;
  } catch {
    return undefined;
  }
}
async function fetchPreviewSymbols(signal?: AbortSignal) {
  const url = new URL("/api/providers/binance/preview", window.location.origin);
  url.searchParams.set("t", String(Date.now()));
  const r = await fetch(url, { cache: "no-store", signal });
  if (!r.ok) return [] as string[];
  const j = (await r.json()) as PreviewResp;
  return (j?.symbols ?? []).map((s) => s.toUpperCase());
}
async function fetchStrAux(symbol: string, signal?: AbortSignal) {
  const url = new URL("/api/str-aux/bins", window.location.origin);
  url.searchParams.set("pairs", symbol);
  url.searchParams.set("window", "30m");
  url.searchParams.set("bins", "128");
  url.searchParams.set("sessionId", "dyn");
  url.searchParams.set("t", String(Date.now()));
  const r = await fetch(url, { cache: "no-store", signal });
  if (!r.ok) return undefined;
  return (await r.json()) as StrBinsResp;
}

/* ───────────────────────────── Page ───────────────────────────── */

export default function DynamicsPage() {
  const { settings } = useSettings();

  const tierText = useMemo(
    () => String((settings as any)?.tierLabel ?? (settings as any)?.tier ?? "—"),
    [settings]
  );

  // Universe
  const universe = useMemo<string[]>(
    () => (settings.coinUniverse?.length ? settings.coinUniverse : ENV_FALLBACK),
    [settings.coinUniverse]
  );

  // Selection
  const [selected, setSelected] = useState<Pair>(() => {
    const [a, b] = universe;
    return { base: a ?? "BTC", quote: b ?? "ETH" };
  });
  useEffect(() => {
    if (!universe.includes(selected.base) || !universe.includes(selected.quote)) {
      const [a, b] = universe;
      setSelected({ base: a ?? "BTC", quote: b ?? "ETH" });
    }
  }, [universe, selected.base, selected.quote]);

  // Preview → rings
  const [previewSyms, setPreviewSyms] = useState<string[]>([]);
  const ringSyms = useMemo(() => new Set(previewSyms), [previewSyms]);

  // Matrices + MEA grid (live)
  const [mat, setMat] = useState<{ coins: string[]; bm?: number[][]; id?: number[][]; drv?: number[][] } | null>(null);
  const [meaGrid, setMeaGrid] = useState<number[][] | undefined>(undefined);

  // STR for selected
  const [str, setStr] = useState({ gfmAbsPct: 0, shifts: 0, swaps: 0, vTendency: 0, latestTs: 0 });

  // key used to force re-mount VM widgets (which own useDomainVM)
  const [vmKey, setVmKey] = useState(0);

  // Auto refresh / metronome
  const defaultMs = Math.max(30_000, Number(settings?.timing?.autoRefreshMs ?? 40_000));
  const [auto, setAuto] = useState(true);
  const [intervalMs, setIntervalMs] = useState(defaultMs);
  const [countdown, setCountdown] = useState(Math.ceil(defaultMs / 1000));

  const refreshAll = useCallback(async () => {
    const ac = new AbortController();
    try {
      const [m, g, syms] = await Promise.all([
        fetchMatricesLatest(universe, ac.signal),
        fetchMeaGrid(universe, ac.signal),
        fetchPreviewSymbols(ac.signal),
      ]);
      setMat({ coins: m.coins, bm: m.matrices?.benchmark, id: m.matrices?.id_pct, drv: m.matrices?.pct_drv });
      setMeaGrid(g);
      setPreviewSyms(syms);

      // STR for current selection
      const sym = `${selected.base}${selected.quote}`.toUpperCase();
      const sj = await fetchStrAux(sym, ac.signal);
      const o = sj?.out?.[sym];
      if (o?.ok) {
        const vIn = Number(o.fm?.vInner ?? 0);
        const vOut = Number(o.fm?.vOuter ?? 0);
        setStr({
          gfmAbsPct: Number(o.gfmDelta?.absPct ?? 0),
          shifts: Number(o.shifts?.nShifts ?? 0),
          swaps: Number(o.swaps ?? 0),
          vTendency: vIn - vOut,
          latestTs: Number(o?.lastUpdateTs ?? sj?.ts) || 0,
        });
      }

      // re-mount VM widgets so they re-fetch converter/vm
      setVmKey((k) => k + 1);
    } finally {
      ac.abort();
    }
  }, [universe, selected.base, selected.quote]);

  // boot + polling
  useEffect(() => {
    let timer: any;
    let tick: any;

    const start = async () => {
      await refreshAll();
      setCountdown(Math.ceil(intervalMs / 1000));

      tick = setInterval(() => {
        setCountdown((s) => (s > 0 ? s - 1 : 0));
      }, 1000);

      timer = setInterval(() => {
        if (document.hidden || !auto) return;
        refreshAll().catch(() => void 0);
        setCountdown(Math.ceil(intervalMs / 1000));
      }, intervalMs);
    };

    start();
    return () => {
      clearInterval(timer);
      clearInterval(tick);
    };
  }, [auto, intervalMs, refreshAll]);

  // Matrix inputs: numbers = MEA, colors = id_pct (from live mat)
  const coinsMatrix: string[] = mat?.coins ?? universe;
  const valueGrid: number[][] | undefined = meaGrid;     // prefer MEA
  const colorGrid: number[][] | undefined = mat?.id;     // id_pct for colors

  // Selected pair metrics (benchm + id) + USDT bridge
  const Ca = selected.base;
  const Cb = selected.quote;
  const pairBm = cell(mat?.bm, mat?.coins, Ca, Cb) ?? 0;
  const pairId = cell(mat?.id, mat?.coins, Ca, Cb) ?? 0;
  const bm_ca_usdt = cell(mat?.bm, mat?.coins, Ca, "USDT") ?? 0;
  const bm_usdt_cb = cell(mat?.bm, mat?.coins, "USDT", Cb) ?? 0;
  const id_ca_usdt = cell(mat?.id, mat?.coins, Ca, "USDT") ?? 0;
  const id_usdt_cb = cell(mat?.id, mat?.coins, "USDT", Cb) ?? 0;

  // Histogram from drv/id
  const drvSamples = useMemo(() => {
    const out: number[] = [];
    const g = mat?.drv ?? mat?.id;
    const cs = mat?.coins ?? [];
    if (!g || !cs.length) return out;
    for (let i = 0; i < cs.length; i++) {
      for (let j = 0; j < cs.length; j++) {
        if (i === j) continue;
        const v = Number(g[i]?.[j]);
        if (Number.isFinite(v)) out.push(v);
      }
    }
    // downsample for crispness
    const MAX = 1800;
    if (out.length > MAX) {
      const step = Math.ceil(out.length / MAX);
      return out.filter((_, k) => k % step === 0);
    }
    return out;
  }, [mat?.drv, mat?.id, mat?.coins]);

  // MEA mini-card (pair)
  const meaForPair = useMemo(() => {
    const v = cell(meaGrid, mat?.coins, Ca, Cb);
    return Number(v ?? 0);
  }, [meaGrid, mat?.coins, Ca, Cb]);

  const subtitle = `${Ca}/${Cb}`;

  /* ───────────────────────────── Render ───────────────────────────── */

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <TopBar
        subtitle={subtitle}
        auto={auto}
        onToggleAuto={() => setAuto((a) => !a)}
        countdown={countdown}
        onRefresh={refreshAll}
      />

      <div className="mx-auto max-w-7xl p-4 lg:p-6 space-y-4">
        {/* TOP: Matrix + Market/Wallet/Histogram */}
        <div className="grid grid-cols-7 gap-4">
          <Panel title="Dynamics" className="col-span-5">
            <MatrixHeatmap
              coins={coinsMatrix}
              valueGrid={valueGrid}
              colorGrid={colorGrid}
              ringSymbols={ringSyms}
              onSelect={(i, j) => {
                if (i === j) return;
                setSelected({ base: coinsMatrix[i]!, quote: coinsMatrix[j]! });
                // immediate STR refresh for the newly selected pair
                fetchStrAux(`${coinsMatrix[i]}${coinsMatrix[j]}`)
                  .then((sj) => {
                    const sym = `${coinsMatrix[i]}${coinsMatrix[j]}`;
                    const o = sj?.out?.[sym];
                    if (!o?.ok) return;
                    const vIn = Number(o.fm?.vInner ?? 0);
                    const vOut = Number(o.fm?.vOuter ?? 0);
                    setStr({
                      gfmAbsPct: Number(o.gfmDelta?.absPct ?? 0),
                      shifts: Number(o.shifts?.nShifts ?? 0),
                      swaps: Number(o.swaps ?? 0),
                      vTendency: vIn - vOut,
                      latestTs: Number(o?.lastUpdateTs ?? sj?.ts) || 0,
                    });
                  })
                  .catch(() => void 0);
              }}
              loading={!mat?.coins?.length}
            />
          </Panel>

          <div className="col-span-2 space-y-4">
            <Panel title="Market · Wallet · Histogram">
              <PairMarketWallet
                pair={selected}
                pairMetrics={{ benchmark: pairBm, id_pct: pairId }}
                balances={{}} // filled by VMWidgets via event
                bridge={{
                  bm: { ca_usdt: bm_ca_usdt, usdt_cb: bm_usdt_cb },
                  id: { ca_usdt: id_ca_usdt, usdt_cb: id_usdt_cb },
                }}
              />
              <div className="mt-3">
                <MicroStrokesHistogram data={drvSamples} heightClass="h-24" />
                <HistogramLegend />
              </div>
            </Panel>
          </div>
        </div>

        {/* BOTTOM: Arb + Metrics */}
        <div className="grid grid-cols-7 gap-4">
          <Panel title="Arbitrage" className="col-span-5">
            <VMWidgets key={vmKey} Ca={Ca} Cb={Cb} universe={universe} />
          </Panel>

          <Panel title="Metrics" className="col-span-2">
            <div className="flex flex-col gap-3">
              <MeaMiniCard value={meaForPair} tier={tierText} />
              <StrAuxCard
                gfmAbsPct={str.gfmAbsPct}
                shifts={str.shifts}
                swaps={str.swaps}
                vTendency={str.vTendency}
                ts={str.latestTs}
              />
              <CinEcho />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────── VM Widgets (keyed) ────────────────────────── */
/** This child owns `useDomainVM` so changing its key forces a re-fetch. */
function VMWidgets({
  Ca,
  Cb,
  universe,
}: {
  Ca: string;
  Cb: string;
  universe: string[];
}) {
  // Filter out Ca/Cb so “candidates” never echo the selected pair in either order
  const candidates = useMemo(
    () => universe.filter((c) => c !== Ca && c !== Cb),
    [universe, Ca, Cb]
  );

  const { vm, loading, error } = useDomainVM(Ca, Cb, universe, candidates);

  // Arb + Wallets
  const arbVm = vm ? toArbTableInput(vm) : { rows: [], wallets: {} as Record<string, number> };
  const wallets: Record<string, number> = (arbVm.wallets ?? {}) as Record<string, number>;
  const rows = (arbVm.rows ?? []) as any[];

  // Mirror CIN rows into a tiny global store for the CIN echo card
  const panelsVm = vm ? toMetricsPanel(vm) : null;
  useEffect(() => {
    window.__CIN_MIRROR__ = panelsVm?.cin ?? {};
  }, [panelsVm?.cin]);

  // Market/Wallet card on parent receives balances through a custom event
  useEffect(() => {
    const evt = new CustomEvent("wallets:update", { detail: wallets });
    window.dispatchEvent(evt);
  }, [wallets]);

  return (
    <>
      <ArbTable
        Ca={Ca}
        Cb={Cb}
        candidates={candidates}
        wallets={wallets}
        rows={rows}
        loading={loading}
      />
      <div className="text-xs text-slate-500 mt-2">
        {loading ? "Loading…" : error ? `Error: ${error}` : null}
      </div>
    </>
  );
}

/* ───────────────────────────── UI Pieces ───────────────────────────── */

function TopBar({
  subtitle,
  auto,
  onToggleAuto,
  countdown,
  onRefresh,
}: {
  subtitle: string;
  auto: boolean;
  onToggleAuto: () => void;
  countdown: number;
  onRefresh: () => void;
}) {
  return (
    <div className="border-b border-slate-900/70 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-2xl font-semibold tracking-tight">Dynamics</div>
          <div className="text-sm text-slate-400">{subtitle}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleAuto}
            className={`rounded-lg px-3 py-1.5 text-sm border ${
              auto
                ? "border-violet-500/50 bg-violet-500/10 text-violet-200"
                : "border-slate-700 bg-slate-800 text-slate-200"
            }`}
            title="Toggle auto refresh"
          >
            {auto ? "⏵ auto" : "⏸ manual"}
          </button>
          <div
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm font-mono tabular-nums text-slate-300"
            title="Next refresh"
          >
            {countdown}s
          </div>
          <button
            onClick={onRefresh}
            className="rounded-lg px-3 py-1.5 text-sm border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
            title="Refresh now"
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}

function Panel({
  title,
  className = "",
  children,
}: {
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-900/60 p-3 ${className}`}>
      {title && <div className="mb-2 text-sm font-semibold text-slate-300">{title}</div>}
      {children}
    </div>
  );
}

/* ───────── Matrix (numbers = MEA, colors = id_pct) with violet ring ───────── */

function MatrixHeatmap({
  coins,
  valueGrid,
  colorGrid,
  ringSymbols,
  onSelect,
  loading,
}: {
  coins: string[];
  valueGrid?: number[][];         // MEA values
  colorGrid?: number[][];         // id_pct colors
  ringSymbols?: Set<string>;      // preview combos
  onSelect: (i: number, j: number) => void;
  loading?: boolean;
}) {
  const fmt5 = (n: number) =>
    Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 5, maximumFractionDigits: 5 });
  const cellSz = "w-[56px] h-[42px] lg:w-[64px] lg:h-[48px]";

  return (
    <div className="overflow-auto">
      <table className="min-w-max text-xs">
        <thead>
          <tr>
            <th className="w-12"></th>
            {coins.map((c) => (
              <th key={c} className="px-2 py-1 text-right text-slate-400 font-mono tabular-nums">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {coins.map((rowSym, i) => (
            <tr key={rowSym}>
              <th className="pr-2 py-1 text-right text-slate-400 font-mono tabular-nums">
                {rowSym}
              </th>
              {coins.map((colSym, j) => {
                const isDiag = i === j;
                const val = cell(valueGrid, coins, rowSym, colSym);
                const clr = cell(colorGrid, coins, rowSym, colSym);
                const inPreview =
                  ringSymbols?.has(`${rowSym}${colSym}`) ||
                  ringSymbols?.has(`${colSym}${rowSym}`);

                return (
                  <td key={`${rowSym}-${colSym}`} className="p-0.5">
                    <button
                      onClick={() => onSelect(i, j)}
                      disabled={isDiag || loading}
                      className={`relative ${cellSz} rounded-md border px-1 ${
                        isDiag || loading
                          ? "opacity-30 cursor-not-allowed bg-slate-800 border-slate-800"
                          : tailwindBandForValue(clr)
                      }`}
                      title={`${rowSym}/${colSym} · ${val != null ? fmt5(val) : "—"}`}
                    >
                      {/* number (5 decimals to expose tiny values) */}
                      {!isDiag && (
                        <span className="absolute inset-0 grid place-items-center font-mono text-[11px]">
                          {val != null ? fmt5(val) : "—"}
                        </span>
                      )}

                      {/* violet ring (thin, more purple) */}
                      {!isDiag && inPreview && (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-[-1.25px] rounded-[8px]"
                          style={{
                            background:
                              "conic-gradient(from 0deg, rgba(216,180,254,.9), rgba(168,85,247,.9), rgba(139,92,246,.9), rgba(216,180,254,.9))",
                            WebkitMask:
                              "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                            WebkitMaskComposite: "xor",
                            padding: "1.25px",
                            borderRadius: "10px",
                          }}
                        />
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───────── Histogram (micro strokes) ───────── */

function MicroStrokesHistogram({ data, heightClass = "h-28" }: { data: number[]; heightClass?: string }) {
  const N = data.length;
  const maxAbs = useMemo(
    () => Math.max(1e-12, ...data.map((d) => Math.abs(Number(d) || 0))),
    [data]
  );
  const baseline = 50;
  const strokeWidth = Math.max(0.25, 100 / Math.max(200, N * 1.2));
  const xStep = 100 / Math.max(1, N);

  return (
    <div className={`w-full ${heightClass}`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
        <line x1="0" y1={baseline} x2="100" y2={baseline} stroke="#334155" strokeWidth="0.6" />
        {data.map((raw, k) => {
          const v = Number(raw) || 0;
          const mag = (Math.abs(v) / maxAbs) * 48;
          const x = k * xStep + xStep / 2;
          const y1 = v >= 0 ? baseline - mag : baseline;
          const y2 = v >= 0 ? baseline : baseline + mag;
          const color = v >= 0 ? "#84cc16" : "#ef4444";
          return <line key={k} x1={x} y1={y1} x2={x} y2={y2} stroke={color} strokeWidth={strokeWidth} />;
        })}
      </svg>
    </div>
  );
}
function HistogramLegend() {
  return (
    <div className="mt-2 flex items-center gap-4 text-[11px] text-slate-400">
      <LegendSwatch color="#84cc16" label="positive (up)" />
      <LegendSwatch color="#ef4444" label="negative (down)" />
      <LegendLine color="#334155" label="zero baseline" />
    </div>
  );
}
function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2" aria-label={label}>
      <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </div>
  );
}
function LegendLine({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2" aria-label={label}>
      <span className="inline-block h-0.5 w-5" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </div>
  );
}

/* ───────── Side cards ───────── */

function PairMarketWallet({
  pair,
  pairMetrics,
  balances,
  bridge,
}: {
  pair: Pair;
  pairMetrics: { benchmark: number; id_pct: number };
  balances: Record<string, number>;
  bridge: { bm: { ca_usdt: number; usdt_cb: number }; id: { ca_usdt: number; usdt_cb: number } };
}) {
  const [wallets, setWallets] = useState<Record<string, number>>(balances);
  useEffect(() => {
    const onUpd = (e: any) => setWallets(e.detail ?? {});
    window.addEventListener("wallets:update", onUpd as any);
    return () => window.removeEventListener("wallets:update", onUpd as any);
  }, []);

  const base = pair.base;
  const quote = pair.quote;

  return (
    <div className="text-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-slate-200 text-lg">
          {base}/{quote}
        </div>
        <div className="font-mono tabular-nums text-slate-100 text-base">
          benchm {fmt(pairMetrics.benchmark, 4)} · id {fmt(pairMetrics.id_pct, 6)}
        </div>
      </div>

      <div className="mb-2 rounded-xl border border-slate-800 bg-slate-950/40 p-2 text-xs">
        <div className="text-slate-400 mb-1">USDT bridge</div>
        <div className="grid grid-cols-2 gap-2 font-mono tabular-nums">
          <div>
            <div className="text-slate-300">{base}→USDT</div>
            <div className="text-slate-400">
              benchm {fmt(bridge.bm.ca_usdt, 4)} · id {fmt(bridge.id.ca_usdt, 6)}
            </div>
          </div>
          <div>
            <div className="text-slate-300">USDT→{quote}</div>
            <div className="text-slate-400">
              benchm {fmt(bridge.bm.usdt_cb, 4)} · id {fmt(bridge.id.usdt_cb, 6)}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <WalletPill title={base} amount={wallets[base] ?? 0} />
        <WalletPill title={quote} amount={wallets[quote] ?? 0} />
        <WalletPill title="USDT" amount={wallets["USDT"] ?? 0} />
      </div>
    </div>
  );
}
function WalletPill({ title, amount }: { title: string; amount: number }) {
  return (
    <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-2">
      <div className="text-slate-300 font-medium">{title}</div>
      <div className="text-slate-400">
        amount: <span className="font-mono tabular-nums">{fmt(amount, 3)}</span>
      </div>
    </div>
  );
}

function MeaMiniCard({ value, tier }: { value: number; tier: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">MEA-AUX</div>
      <div className="mt-1 flex items-end justify-between">
        <div className="text-2xl font-mono tabular-nums">{fmt(value, Math.abs(value) < 1e-3 ? 6 : 5)}</div>
        <div className="text-sm text-slate-300">
          tier <span className="font-semibold">{tier}</span>
        </div>
      </div>
    </div>
  );
}

function StrAuxCard({
  gfmAbsPct,
  shifts,
  swaps,
  vTendency,
  ts,
}: {
  gfmAbsPct: number;
  shifts: number;
  swaps: number;
  vTendency: number;
  ts?: number;
}) {
  const tsStr = ts ? new Date(ts).toLocaleTimeString(undefined, { hour12: false }) : "—";
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">str-aux</div>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <KV k="GFM Δ%" v={gfmAbsPct} />
        <KV k="vTendency" v={vTendency} />
        <KV k="Shifts" v={shifts} />
        <KV k="Swaps" v={swaps} />
      </div>
      <div className="mt-1 text-[11px] text-slate-500">ts {tsStr}</div>
    </div>
  );
}

// CIN echo pulls mirrored VM cin rows from window (lightweight bridge)
function CinEcho() {
  const [, force] = useState(0);
  const [rows, setRows] = useState<Record<
    string,
    { session?: { imprint?: number; luggage?: number }; cycle?: { imprint?: number; luggage?: number } }
  >>({});

  useEffect(() => {
    const id = setInterval(() => {
      setRows(window.__CIN_MIRROR__ ?? {});
      force((x) => x + 1);
    }, 1500);
    return () => clearInterval(id);
  }, []);

  const keys = Object.keys(rows).slice(0, 2);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs">
      <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-2">cin-aux</div>
      <table className="w-full">
        <thead>
          <tr className="text-slate-400">
            <th className="text-left"></th>
            <th className="text-right">Imp-Ses</th>
            <th className="text-right">Lug-Ses</th>
            <th className="text-right">Imp-Cyc</th>
            <th className="text-right">Lug-Cyc</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((sym) => {
            const r = rows[sym] ?? {};
            const s = r.session ?? {};
            const c = r.cycle ?? {};
            return (
              <tr key={sym} className="border-t border-slate-800">
                <td className="py-1 font-medium text-slate-300">{sym}</td>
                <td className="py-1 text-right font-mono tabular-nums">{fmt(Number(s.imprint ?? 0), 6)}</td>
                <td className="py-1 text-right font-mono tabular-nums">{fmt(Number(s.luggage ?? 0), 6)}</td>
                <td className="py-1 text-right font-mono tabular-nums">{fmt(Number(c.imprint ?? 0), 6)}</td>
                <td className="py-1 text-right font-mono tabular-nums">{fmt(Number(c.luggage ?? 0), 6)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function KV({ k, v }: { k: string; v: number | string }) {
  const isNum = typeof v === "number";
  const d = isNum ? (Math.abs(v as number) < 1e-3 ? 6 : 3) : undefined;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-2">
      <div className="text-[11px] text-slate-400">{k}</div>
      <div className="text-lg font-mono tabular-nums">
        {isNum ? fmt(v as number, d) : v}
      </div>
    </div>
  );
}
