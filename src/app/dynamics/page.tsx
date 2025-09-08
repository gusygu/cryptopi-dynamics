"use client";

import React, { useMemo, useState } from "react";
import ArbTable from "@/app/dynamics/ArbTable";
import {
  useDomainVM,
  toArbTableInput,
  toMatrix,
  toMetricsPanel,
} from "@/converters/Converter.client";

type Pair = { base: string; quote: string };

const COIN_UNIVERSE = (process.env.NEXT_PUBLIC_COINS ?? "BTC,ETH,BNB,SOL,ADA,USDT")
  .split(",")
  .map((s) => s.trim().toUpperCase());

// ---------- helpers ----------
function getCell(
  grid: number[][] | undefined,
  coins: string[],
  from: string,
  to: string
): number | undefined {
  if (!grid) return undefined;
  const i = coins.indexOf(from);
  const j = coins.indexOf(to);
  if (i < 0 || j < 0) return undefined;
  return grid[i]?.[j];
}
const fmt = (x: number, d = 3) =>
  Number(x ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
function cellColorFromSigned(v: number) {
  const mag = Math.min(1, Math.tanh(Math.abs(v) / 50));
  const hue = v >= 0 ? 210 : 25;
  const light = 16 + 24 * mag;
  return `hsl(${hue} 70% ${light}%)`;
}

// ---------- page ----------
export default function DynamicsPage() {
  const initialPair: Pair =
    COIN_UNIVERSE.includes("ETH") && COIN_UNIVERSE.includes("USDT")
      ? { base: "ETH", quote: "USDT" }
      : { base: COIN_UNIVERSE[0]!, quote: COIN_UNIVERSE[1] ?? COIN_UNIVERSE[0]! };

  const [selected, setSelected] = useState<Pair>(initialPair);

  const candidates = useMemo(() => {
    const pool = COIN_UNIVERSE.filter((c) => c !== selected.base && c !== selected.quote);
    return pool.slice(0, 4);
  }, [selected.base, selected.quote]);

  const { vm, loading, error } = useDomainVM(
    selected.base,
    selected.quote,
    COIN_UNIVERSE,
    candidates
  );

  // safe fallbacks
  const coins = vm?.coins ?? COIN_UNIVERSE;
  const matrix = vm ? toMatrix(vm) : { benchmark: undefined, id_pct: undefined as number[][] | undefined };
  const arb    = vm ? toArbTableInput(vm) : { rows: [], wallets: {} as Record<string, number> };
  const panels = vm ? toMetricsPanel(vm)  : {
    mea: { value: 0, tier: "—" },
    str: { gfm: 0, shift: 0, vTendency: 0 },
    cin: {},
  };

  const Ca = selected.base;
  const Cb = selected.quote;
  const subtitle = `${Ca}/${Cb}`;

  // market numbers (RAW id_pct, bm to 4dp)
  const pairBm = getCell(matrix.benchmark, coins, Ca, Cb) ?? 0;
  const pairIdRaw = getCell(matrix.id_pct, coins, Ca, Cb) ?? 0;

  // USDT bridge metrics for display (Ca→USDT and USDT→Cb)
  const bm_ca_usdt = getCell(matrix.benchmark, coins, Ca, "USDT") ?? 0;
  const bm_usdt_cb = getCell(matrix.benchmark, coins, "USDT", Cb) ?? 0;
  const id_ca_usdt = getCell(matrix.id_pct, coins, Ca, "USDT") ?? 0;
  const id_usdt_cb = getCell(matrix.id_pct, coins, "USDT", Cb) ?? 0;

  // histogram uses str-aux pct derivative history if present
  const pctDrv = (vm as any)?.series?.pct_drv ?? [];

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl p-4 lg:p-6 space-y-4">
        <Header subtitle={subtitle} />

        {/* TOP: Matrix + Market & Wallet */}
        <div className="grid grid-cols-7 gap-4">
          <Panel title="Interactive Matrix" className="col-span-5">
            <MatrixHeatmap
              coins={coins}
              idGrid={matrix.mea /* if you later attach MEA grid, show it here; else switch to id_pct */}
              onSelect={(i, j) => {
                if (i === j) return;
                setSelected({ base: coins[i]!, quote: coins[j]! });
              }}
              loading={loading}
            />
          </Panel>

          <div className="col-span-2 space-y-4">
            <Panel title="Histogram (pct_drv)">
              <BarsHistogram data={pctDrv} heightClass="h-28" />
              <HistogramLegend />
            </Panel>
            <Panel title="Market & Wallet">
              <PairMarketWallet
                pair={selected}
                pairMetrics={{ benchmark: pairBm, id_pct: pairIdRaw }}
                balances={arb.wallets}
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
              candidates={candidates}
              wallets={arb.wallets}
              rows={arb.rows as any}   // ← accept new per-column rows
              loading={loading}
            />
          </Panel>

          <Panel title="Metrics" className="col-span-2">
            <div className="flex flex-col gap-3">
              <MeaMiniCard value={panels.mea.value} tier={panels.mea.tier} />
              <StrAuxCard
                gfm={panels.str.gfm}
                shift={panels.str.shift}
                vTendency={panels.str.vTendency}
              />
              <CinAuxTable pair={selected} rows={panels.cin} />
            </div>
          </Panel>
        </div>

        {/* status */}
        <div className="text-xs text-slate-500">
          {loading ? "Loading…" : error ? `Error: ${error}` : null}
        </div>
      </div>
    </div>
  );
}

// ---------- primitives ----------
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

function MatrixHeatmap({
  coins,
  idGrid,
  onSelect,
  loading,
}: {
  coins: string[];
  idGrid?: number[][];
  onSelect: (i: number, j: number) => void;
  loading?: boolean;
}) {
  const cell = "w-12 h-10 lg:w-14 lg:h-12";
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
          {coins.map((_, i) => (
            <tr key={i}>
              <th className="pr-2 py-1 text-right text-slate-400 font-mono tabular-nums">
                {coins[i]}
              </th>
              {coins.map((_, j) => {
                const v = getCell(idGrid, coins, coins[i]!, coins[j]!) ?? 0;
                const isDiag = i === j;
                return (
                  <td key={`${i}-${j}`} className="p-0.5">
                    <button
                      onClick={() => onSelect(i, j)}
                      disabled={isDiag || loading}
                      className={`${cell} rounded-md transition-transform ${
                        isDiag || loading
                          ? "opacity-30 cursor-not-allowed bg-slate-800"
                          : "hover:scale-[1.03]"
                      }`}
                      style={{ background: isDiag ? undefined : cellColorFromSigned(v) }}
                      title={`${coins[i]}/${coins[j]} · value=${v}`}
                    />
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

/** Bars-style histogram: uses signed pct derivative (pct_drv). */
function BarsHistogram({
  data,
  heightClass = "h-28",
}: {
  data: number[];
  heightClass?: string;
}) {
  const N = data.length;
  const maxAbs = useMemo(
    () => Math.max(1e-12, ...data.map((d) => Math.abs(d))),
    [data]
  );
  const barW = 100 / Math.max(1, N);
  return (
    <div className={`w-full ${heightClass}`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
        {/* zero baseline */}
        <line x1="0" y1="50" x2="100" y2="50" stroke="#334155" strokeWidth="0.5" />
        {/* bars */}
        {data.map((v, k) => {
          const h = (Math.abs(v) / maxAbs) * 48; // leave margin
          const x = k * barW + 0.5;
          const y = v >= 0 ? 50 - h : 50;
          const color = v >= 0 ? "#86a9ff" : "#f6a97a";
          return <rect key={k} x={x} y={y} width={barW - 1} height={h} fill={color} />;
        })}
      </svg>
    </div>
  );
}

function HistogramLegend() {
  return (
    <div className="mt-2 flex items-center gap-4 text-[11px] text-slate-400">
      <LegendSwatch color="#86a9ff" label="positive (up)" />
      <LegendSwatch color="#f6a97a" label="negative (down)" />
      <LegendLine   color="#334155" label="zero baseline" />
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

      {/* USDT Bridge line (bm & id_pct for Ca→USDT and USDT→Cb) */}
      <div className="mb-2 rounded-xl border border-slate-800 bg-slate-950/40 p-2 text-xs">
        <div className="text-slate-400 mb-1">USDT bridge</div>
        <div className="grid grid-cols-2 gap-2 font-mono tabular-nums">
          <div>
            <div className="text-slate-300">{base}→USDT</div>
            <div className="text-slate-400">bm {fmt(bridge.bm.ca_usdt, 4)} · id {fmt(bridge.id.ca_usdt, 6)}</div>
          </div>
          <div>
            <div className="text-slate-300">USDT→{quote}</div>
            <div className="text-slate-400">bm {fmt(bridge.bm.usdt_cb, 4)} · id {fmt(bridge.id.usdt_cb, 6)}</div>
          </div>
        </div>
      </div>

      {/* Wallet cards (no "usdt bridged" line anymore) */}
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

function CinAuxTable({
  pair,
  rows,
}: {
  pair: Pair;
  rows: Record<
    string,
    { session: { imprint: number; luggage: number }; cycle: { imprint: number; luggage: number } }
  >;
}) {
  const data: Record<
    string,
    { session: { imprint: number; luggage: number }; cycle: { imprint: number; luggage: number } }
  > = {
    [pair.base]: rows[pair.base] ?? { session: { imprint: 0, luggage: 0 }, cycle: { imprint: 0, luggage: 0 } },
    [pair.quote]: rows[pair.quote] ?? { session: { imprint: 0, luggage: 0 }, cycle: { imprint: 0, luggage: 0 } },
  };

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
          {Object.entries(data).map(([coin, rec]) => (
            <tr key={coin} className="border-t border-slate-800">
              <td className="py-1 font-medium text-slate-300">{coin}</td>
              <td className="py-1 text-right font-mono tabular-nums">{fmt(rec.session.imprint)}</td>
              <td className="py-1 text-right font-mono tabular-nums">{fmt(rec.session.luggage)}</td>
              <td className="py-1 text-right font-mono tabular-nums">{fmt(rec.cycle.imprint)}</td>
              <td className="py-1 text-right font-mono tabular-nums">{fmt(rec.cycle.luggage)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  gfm,
  shift,
  vTendency,
}: {
  gfm: number;
  shift: number;
  vTendency: number;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">str-aux</div>
      <div className="mt-1 grid grid-cols-3 gap-2">
        <KV k="GFM" v={gfm} />
        <KV k="shift" v={shift} />
        <KV k="vTendency" v={vTendency} />
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: number | string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-2">
      <div className="text-[11px] text-slate-400">{k}</div>
      <div className="text-lg font-mono tabular-nums">
        {typeof v === "number" ? fmt(v) : v}
      </div>
    </div>
  );
}
