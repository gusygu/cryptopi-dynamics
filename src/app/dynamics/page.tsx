"use client";

import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import ArbTable from "@/app/dynamics/ArbTable";
import {
  useDomainVM,
  toArbTableInput,
  toMatrix,
  toMetricsPanel,
} from "@/converters/Converter.client";
import { useSettings } from "@/lib/settings/provider";

/* ============================= Types & Helpers ============================= */

type Pair = { base: string; quote: string };

type MatricesResp = {
  ok: boolean;
  coins: string[];
  matrices: Partial<Record<"benchmark" | "id_pct" | "pct_drv", number[][]>>;
};

type MeaResp = { ok: boolean; grid?: number[][] };

type StrBinsResp = {
  ok: boolean;
  ts: number;
  symbols: string[];
  out: Record<
    string,
    {
      ok: boolean;
      fm?: {
        gfm_ref_price?: number;
        gfm_calc_price?: number;
        sigma?: number;
        vInner?: number;
        vOuter?: number;
        nuclei?: { binIndex: number }[];
      };
      gfmDelta?: { absPct?: number };
      shifts?: { nShifts: number; timelapseSec: number; latestTs: number };
      shift_stamp?: boolean;
      swaps?: number;
     lastUpdateTs?: number; // ← add this line
    }
  >;
};

const ENV_FALLBACK = (process.env.NEXT_PUBLIC_COINS ?? "BTC,ETH,BNB,SOL,ADA,XRP,PEPE,DOGE,USDT")
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
  a: string | undefined,
  b: string | undefined
): number | undefined {
  if (!g || !coins || !a || !b) return undefined;
  const i = coins.indexOf(a);
  const j = coins.indexOf(b);
  if (i < 0 || j < 0) return undefined;
  return g[i]?.[j];
}

/** color by id_pct sign/magnitude */
function cellColorFromSigned(v: number) {
  const mag = Math.min(1, Math.tanh(Math.abs(v) / 50));
  const hue = v >= 0 ? 152 : 6; // greens/reds
  const sat = 70;
  const light = 16 + Math.round(24 * mag);
  return `hsl(${hue} ${sat}% ${light}%)`;
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

async function fetchStrAuxForPair(symbol: string, signal?: AbortSignal) {
  const url = new URL("/api/str-aux/bins", window.location.origin);
  url.searchParams.set("pairs", symbol);
  url.searchParams.set("window", "30m");
  url.searchParams.set("bins", "128");
  url.searchParams.set("sessionId", "dyn");
  const r = await fetch(url, { cache: "no-store", signal });
  if (!r.ok) throw new Error(`str-aux HTTP ${r.status}`);
  return (await r.json()) as StrBinsResp;
}

/* ================================= Page ================================== */

export default function DynamicsPage() {
  const { settings } = useSettings();

  // Universe from Settings (fallback to env)
  const universe = useMemo<string[]>(
    () => (settings.coinUniverse?.length ? settings.coinUniverse : ENV_FALLBACK),
    [settings.coinUniverse]
  );

  // Selected pair
  const [selected, setSelected] = useState<Pair>(() => {
    const [a, b] = universe;
    return { base: a ?? "ETH", quote: b ?? "USDT" };
  });
  useEffect(() => {
    if (!universe.includes(selected.base) || !universe.includes(selected.quote)) {
      const [a, b] = universe;
      setSelected({ base: a ?? "ETH", quote: b ?? "USDT" });
    }
  }, [universe, selected.base, selected.quote]);

  // Cluster-aware pool; fallback to full universe if cluster is too small
  const clusterCoins = settings.clustering?.clusters?.[0]?.coins ?? [];
  const basePool = (clusterCoins?.length ?? 0) >= 5 ? clusterCoins : universe;

  const candidatesAll = useMemo<string[]>(
    () => basePool.filter((c: string) => c !== selected.base && c !== selected.quote),
    [basePool, selected.base, selected.quote]
  );

  // VM: keep using converter (so when it’s fixed, page benefits automatically)
  const { vm, loading, error } = useDomainVM(
    selected.base,
    selected.quote,
    universe,
    candidatesAll
  );

  // VM-derived panels / matrix / arb
  const coinsVm: string[] = vm?.coins ?? universe;
  const matrixVm = vm ? toMatrix(vm) : ({} as { benchmark?: number[][]; id_pct?: number[][] });
  const arbVm = vm ? toArbTableInput(vm) : { rows: [], wallets: {} as Record<string, number> };
  const panelsVm = vm
    ? toMetricsPanel(vm)
    : { mea: { value: 0, tier: "—" }, str: { gfm: 0, shift: 0, vTendency: 0 }, cin: {} as Record<string, any> };

  // Live Matrices + MEA (fallback source of truth)
  const [mat, setMat] = useState<{ coins: string[]; bm?: number[][]; id?: number[][]; drv?: number[][] } | null>(null);
  const [meaGrid, setMeaGrid] = useState<number[][] | undefined>(undefined);

  // STR-AUX live for the selected symbol
  const [str, setStr] = useState<{
    gfmAbsPct: number;
    shifts: number;
    swaps: number;
    vTendency: number;
    latestTs?: number;
  }>({ gfmAbsPct: 0, shifts: 0, swaps: 0, vTendency: 0 });

  const refreshMatrices = useCallback(async (ac?: AbortController) => {
    const m = await fetchMatricesLatest(universe, ac?.signal);
    setMat({ coins: m.coins, bm: m.matrices?.benchmark, id: m.matrices?.id_pct, drv: m.matrices?.pct_drv });
    const g = await fetchMeaGrid(universe, ac?.signal);
    if (g && Array.isArray(g)) setMeaGrid(g);
  }, [universe]);

  const refreshStrAux = useCallback(async (ac?: AbortController) => {
    const sym = `${selected.base}${selected.quote}`.toUpperCase();
    const j = await fetchStrAuxForPair(sym, ac?.signal);
    const o = j?.out?.[sym];
    if (!o?.ok) return;
    const vIn = Number(o.fm?.vInner ?? 0);
    const vOut = Number(o.fm?.vOuter ?? 0);
    const vTendency = vIn - vOut; // simple tendency proxy
    const gfmAbsPct = Number(o.gfmDelta?.absPct ?? 0);
    const shifts = Number(o.shifts?.nShifts ?? 0);
    const swaps = Number(o.swaps ?? 0);
    setStr({ gfmAbsPct, shifts, swaps, vTendency, latestTs: Number(o?.lastUpdateTs ?? j?.ts) || undefined });
  }, [selected.base, selected.quote]);

  // initial + poll
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        await refreshMatrices(ac);
      } catch { /* ignore */ }
      try {
        await refreshStrAux(ac);
      } catch { /* ignore */ }
    })();

    const refreshMs = Math.max(30_000, Number(settings?.timing?.autoRefreshMs ?? 40_000));
    const id = setInterval(() => {
      if (!document.hidden) {
        refreshMatrices(ac).catch(() => void 0);
        refreshStrAux(ac).catch(() => void 0);
      }
    }, refreshMs);

    return () => { ac.abort(); clearInterval(id); };
  }, [refreshMatrices, refreshStrAux, settings?.timing?.autoRefreshMs]);

  // Interactive matrix inputs
  const coinsMatrix: string[] = mat?.coins ?? coinsVm;
  const numbersGrid: number[][] | undefined = meaGrid ?? mat?.id ?? matrixVm.id_pct; // values from MEA → fallback to id_pct
  const colorsGrid: number[][] | undefined = mat?.id ?? matrixVm.id_pct;             // colors by id_pct

  // Market for selected pair
  const Ca = selected.base;
  const Cb = selected.quote;

  const pairBm =
    cell(mat?.bm, mat?.coins, Ca, Cb) ?? cell(matrixVm.benchmark, coinsVm, Ca, Cb) ?? 0;
  const pairId =
    cell(mat?.id, mat?.coins, Ca, Cb) ?? cell(matrixVm.id_pct, coinsVm, Ca, Cb) ?? 0;

  // Bridge snippets
  const bm_ca_usdt = cell(mat?.bm, mat?.coins, Ca, "USDT") ?? 0;
  const bm_usdt_cb = cell(mat?.bm, mat?.coins, "USDT", Cb) ?? 0;
  const id_ca_usdt = cell(mat?.id, mat?.coins, Ca, "USDT") ?? 0;
  const id_usdt_cb = cell(mat?.id, mat?.coins, "USDT", Cb) ?? 0;

  /* ----------------------- Histogram data (micro) ----------------------- */
  // Ancient-like: very thin strokes, many samples, built from the entire pct_drv matrix (off-diagonal).
  const drvSamples: number[] = useMemo(() => {
    const out: number[] = [];
    const g = mat?.drv;
    const cs = mat?.coins ?? [];
    if (g && cs.length) {
      for (let i = 0; i < cs.length; i++) {
        for (let j = 0; j < cs.length; j++) {
          if (i === j) continue;
          const v = Number(g[i]?.[j]);
          if (Number.isFinite(v)) out.push(v);
        }
      }
    } else if (mat?.id && cs.length) {
      // fallback: use id_pct magnitudes as a proxy when pct_drv is not ready
      for (let i = 0; i < cs.length; i++) {
        for (let j = 0; j < cs.length; j++) {
          if (i === j) continue;
          const v = Number(mat.id[i]?.[j]);
          if (Number.isFinite(v)) out.push(v);
        }
      }
    }
    // clamp & downsample to keep the plot crisp
    const MAX = 1500;
    if (out.length > MAX) {
      const step = Math.ceil(out.length / MAX);
      return out.filter((_, k) => k % step === 0);
    }
    return out;
  }, [mat?.drv, mat?.id, mat?.coins]);

  // Arb rows (keep existing behavior; ArbTable itself is fine)
  const arbVmRows = (arbVm.rows ?? []) as any[];
  const wallets: Record<string, number> = (arbVm.wallets ?? {}) as Record<string, number>;

  const subtitle = `${Ca}/${Cb}`;

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl p-4 lg:p-6 space-y-4">
        <Header subtitle={subtitle} />

        {/* TOP: Matrix + Market & Wallet */}
        <div className="grid grid-cols-7 gap-4">
          <Panel title="Interactive Matrix" className="col-span-5">
            <MatrixHeatmap
              coins={coinsMatrix}
              valueGrid={numbersGrid}
              colorGrid={colorsGrid}
              onSelect={(i: number, j: number) => {
                if (i === j) return;
                setSelected({ base: coinsMatrix[i]!, quote: coinsMatrix[j]! });
              }}
              loading={loading}
            />
          </Panel>

          <div className="col-span-2 space-y-4">
            <Panel title="Histogram (pct_drv — micro)">
              <MicroStrokesHistogram data={drvSamples} heightClass="h-28" />
              <HistogramLegend />
            </Panel>

            <Panel title="Market & Wallet">
              <PairMarketWallet
                pair={selected}
                pairMetrics={{ benchmark: pairBm, id_pct: pairId }}
                balances={wallets}
                bridge={{
                  bm: { ca_usdt: bm_ca_usdt, usdt_cb: bm_usdt_cb },
                  id: { ca_usdt: id_ca_usdt, usdt_cb: id_usdt_cb },
                }}
              />
            </Panel>
          </div>
        </div>

        {/* BOTTOM: Arb + Metrics */}
        <div className="grid grid-cols-7 gap-4">
          <Panel title="Arbitrage" className="col-span-5">
            <ArbTable
              Ca={Ca}
              Cb={Cb}
              candidates={candidatesAll}
              wallets={wallets}
              rows={arbVmRows}
              loading={loading}
            />
          </Panel>

          <Panel title="Metrics" className="col-span-2">
            <div className="flex flex-col gap-3">
              {/* MEA from converter VM (kept) */}
              <MeaMiniCard value={panelsVm.mea.value} tier={panelsVm.mea.tier} />

              {/* STR-AUX wired to /api/str-aux/bins */}
              <StrAuxCard
                gfmAbsPct={str.gfmAbsPct}
                shifts={str.shifts}
                swaps={str.swaps}
                vTendency={str.vTendency}
                ts={str.latestTs}
              />

              {/* CIN-AUX mini (unchanged shape) */}
              <CinMiniCard pair={selected} rows={panelsVm.cin as Record<string, any>} />
            </div>
          </Panel>
        </div>

        <div className="text-xs text-slate-500">
          {loading ? "Loading…" : error ? `Error: ${error}` : null}
        </div>
      </div>
    </div>
  );
}

/* =============================== UI Pieces =============================== */

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

function Header({ subtitle }: { subtitle: string }) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
      <div>
        <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">Dynamics</h1>
        <p className="text-sm text-slate-400">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
        <input
          placeholder="Filter coins, tiers, metrics…"
          className="w-64 rounded-xl bg-slate-900/60 border border-slate-800 px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
        />
        <button className="rounded-xl border border-slate-800 px-3 py-2 text-sm hover:bg-slate-800">
          Settings
        </button>
      </div>
    </div>
  );
}

/** Matrix showing numbers (MEA or id_pct) and colors (id_pct) */
function MatrixHeatmap({
  coins,
  valueGrid,
  colorGrid,
  onSelect,
  loading,
}: {
  coins: string[];
  valueGrid?: number[][];
  colorGrid?: number[][];
  onSelect: (i: number, j: number) => void;
  loading?: boolean;
}) {
  const cellSz = "w-12 h-10 lg:w-14 lg:h-12";
  const fmt3 = (n: number) =>
    Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return (
    <div className="overflow-auto">
      <table className="min-w-max text-xs">
        <thead>
          <tr>
            <th className="w-12"></th>
            {coins.map((c: string) => (
              <th key={c} className="px-2 py-1 text-right text-slate-400 font-mono tabular-nums">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {coins.map((_, i: number) => (
            <tr key={i}>
              <th className="pr-2 py-1 text-right text-slate-400 font-mono tabular-nums">
                {coins[i]}
              </th>
              {coins.map((__, j: number) => {
                const val =
                  (cell(valueGrid, coins, coins[i], coins[j]) as number | undefined) ?? 0;
                const clr =
                  (cell(colorGrid, coins, coins[i], coins[j]) as number | undefined) ?? 0;
                const isDiag = i === j;
                return (
                  <td key={`${i}-${j}`} className="p-0.5">
                    <button
                      onClick={() => onSelect(i, j)}
                      disabled={isDiag || loading}
                      className={`${cellSz} rounded-md relative overflow-hidden ${
                        isDiag || loading ? "opacity-30 cursor-not-allowed bg-slate-800" : "hover:scale-[1.03]"
                      }`}
                      style={{ background: isDiag ? undefined : cellColorFromSigned(clr) }}
                      title={`${coins[i]}/${coins[j]} · value=${val}`}
                    >
                      {!isDiag && (
                        <span className="absolute inset-0 grid place-items-center font-mono text-[11px] text-slate-100">
                          {fmt3(val)}
                        </span>
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

/* -------- Histogram: ancient-style micro strokes over zero baseline -------- */
function MicroStrokesHistogram({ data, heightClass = "h-28" }: { data: number[]; heightClass?: string }) {
  const N = data.length;
  const maxAbs = useMemo<number>(() => Math.max(1e-12, ...data.map((d) => Math.abs(Number(d) || 0))), [data]);
  // visual params
  const baseline = 50; // center line
  const strokeWidth = Math.max(0.25, 100 / Math.max(200, N * 1.2)); // thinner with more samples
  const xStep = 100 / Math.max(1, N);

  return (
    <div className={`w-full ${heightClass}`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
        {/* zero baseline */}
        <line x1="0" y1={baseline} x2="100" y2={baseline} stroke="#334155" strokeWidth="0.6" />
        {/* strokes */}
        {data.map((raw, k) => {
          const v = Number(raw) || 0;
          const mag = (Math.abs(v) / maxAbs) * 48; // 0..48px around baseline
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

/* ---------------------- side cards (kept & updated) ---------------------- */

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
  const base = pair.base;
  const quote = pair.quote;
  const wBase = balances[base] ?? 0;
  const wQuote = balances[quote] ?? 0;
  const wUSDT = balances["USDT"] ?? 0;

  return (
    <div className="text-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-slate-200 text-lg">
          {base}/{quote}
        </div>
        <div className="font-mono tabular-nums text-slate-100 text-base">
          bm {fmt(pairMetrics.benchmark, 4)} · id {fmt(pairMetrics.id_pct, 6)}
        </div>
      </div>

      <div className="mb-2 rounded-xl border border-slate-800 bg-slate-950/40 p-2 text-xs">
        <div className="text-slate-400 mb-1">USDT bridge</div>
        <div className="grid grid-cols-2 gap-2 font-mono tabular-nums">
          <div>
            <div className="text-slate-300">{base}→USDT</div>
            <div className="text-slate-400">
              bm {fmt(bridge.bm.ca_usdt, 4)} · id {fmt(bridge.id.ca_usdt, 6)}
            </div>
          </div>
          <div>
            <div className="text-slate-300">USDT→{quote}</div>
            <div className="text-slate-400">
              bm {fmt(bridge.bm.usdt_cb, 4)} · id {fmt(bridge.id.usdt_cb, 6)}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <WalletPill title={base} amount={wBase} />
        <WalletPill title={quote} amount={wQuote} />
        <WalletPill title="USDT" amount={wUSDT} />
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
        <div className="text-2xl font-mono tabular-nums">{fmt(value)}</div>
        <div className="text-sm text-slate-300">
          Tier <span className="font-semibold">{tier}</span>
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

function CinMiniCard({
  pair,
  rows,
}: {
  pair: Pair;
  rows: Record<
    string,
    { session?: { imprint?: number; luggage?: number }; cycle?: { imprint?: number; luggage?: number } }
  >;
}) {
  const pick = (sym: string) => {
    const r = rows?.[sym] ?? {};
    const ses = (r as any).session ?? {};
    const cyc = (r as any).cycle ?? {};
    return {
      sesI: Number(ses.imprint ?? 0),
      sesL: Number(ses.luggage ?? 0),
      cycI: Number(cyc.imprint ?? 0),
      cycL: Number(cyc.luggage ?? 0),
    };
  };
  const A = pick(pair.base);
  const B = pick(pair.quote);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs">
      <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-2">cin-aux</div>
      <table className="w-full">
        <thead>
          <tr className="text-slate-400">
            <th className="text-left"></th>
            <th className="text-right">Impr-ses</th>
            <th className="text-right">Lug-ses</th>
            <th className="text-right">Impr-cyc</th>
            <th className="text-right">Lug-cyc</th>
          </tr>
        </thead>
        <tbody>
          {[pair.base, pair.quote].map((sym: string) => {
            const r = sym === pair.base ? A : B;
            return (
              <tr key={sym} className="border-t border-slate-800">
                <td className="py-1 font-medium text-slate-300">{sym}</td>
                <td className="py-1 text-right font-mono tabular-nums">{fmt(r.sesI)}</td>
                <td className="py-1 text-right font-mono tabular-nums">{fmt(r.sesL)}</td>
                <td className="py-1 text-right font-mono tabular-nums">{fmt(r.cycI)}</td>
                <td className="py-1 text-right font-mono tabular-nums">{fmt(r.cycL)}</td>
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
