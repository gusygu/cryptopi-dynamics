"use client";

import React from "react";
import { useStrategyAux } from "@/lab/legacy/hooks/useStrAux";
import type { StrategyAuxResult } from "@/lab/str-aux/types";

function fmt6(x: any) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "–";
  return n.toFixed(6);
}
function pct(x: any) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "–";
  // If you store pct24h as fraction, show %; if already percent, adjust here.
  return (n * 100).toFixed(2) + "%";
}

type Props = {
  base?: string;
  quote?: string;
  win?: "30m" | "1h" | "3h";
  appSessionId?: string;
};

export default function Dashboard({
  base = "BTC",
  quote = "USDT",
  win = "30m",
  appSessionId = "default",
}: Props) {
  const { loading, error, cur, prev, refreshedAt } = useStrategyAux({ base, quote, win, appSessionId, pollMs: 5000 });

  const data = cur as StrategyAuxResult | undefined;
  const prevData = prev as StrategyAuxResult | undefined;

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-semibold">CryptoPi — Strategy AUX</h2>

      <div className="text-xs text-gray-400">
        pair: <span className="font-mono">{base}{quote}</span> · window: <span className="font-mono">{win}</span> · refreshed:{" "}
        <span className="font-mono">{refreshedAt ? new Date(refreshedAt).toLocaleTimeString() : "—"}</span>
      </div>

      {loading && <div className="text-sm text-gray-500">loading…</div>}
      {error && <div className="text-sm text-rose-600 font-mono">error: {error}</div>}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Opening */}
          <div className="rounded-2xl p-4 shadow bg-white/70">
            <div className="text-xs text-gray-400 mb-2">Opening</div>
            <div className="text-sm grid grid-cols-2 gap-y-1 font-mono">
              <span className="text-gray-500">benchmark</span><span>{fmt6(data.opening.benchmark)}</span>
              <span className="text-gray-500">pct24h</span><span>{pct(data.opening.pct24h)}</span>
              <span className="text-gray-500">id_pct</span><span>{fmt6(data.opening.id_pct)}</span>
              <span className="text-gray-500">layout</span><span className="truncate">{(data.opening as any).layoutHash ?? (data.opening as any).layout ?? "orderbook-live-v1"}</span>
            </div>
          </div>

          {/* Benchmark band (OHLC/VWAP-fed) */}
          <div className="rounded-2xl p-4 shadow bg-white/70">
            <div className="text-xs text-gray-400 mb-2">Benchmark band</div>
            <div className="text-sm grid grid-cols-2 gap-y-1 font-mono">
              <span className="text-gray-500">prev</span><span>{fmt6(data.strValues?.benchmark?.abs?.prev)}</span>
              <span className="text-gray-500">cur</span><span>{fmt6(data.strValues?.benchmark?.abs?.cur)}</span>
              <span className="text-gray-500">maxTurn</span><span>{fmt6(data.strValues?.benchmark?.abs?.maxTurn)}</span>
              <span className="text-gray-500">minTurn</span><span>{fmt6(data.strValues?.benchmark?.abs?.minTurn)}</span>
              <span className="text-gray-500">VWAP</span><span>{fmt6(data.strValues?.benchmark?.quant?.cur)}</span>
              <span className="text-gray-500">VWAP TopN</span><span>{fmt6(data.strValues?.benchmark?.quant?.maxTurn)}</span>
            </div>
          </div>

          {/* ID / spread band */}
          <div className="rounded-2xl p-4 shadow bg-white/70">
            <div className="text-xs text-gray-400 mb-2">Identity / spread</div>
            <div className="text-sm grid grid-cols-2 gap-y-1 font-mono">
              <span className="text-gray-500">prev</span><span>{fmt6(data.strValues?.id_pct?.abs?.prev)}</span>
              <span className="text-gray-500">cur</span><span>{fmt6(data.strValues?.id_pct?.abs?.cur)}</span>
              <span className="text-gray-500">maxTurn</span><span>{fmt6(data.strValues?.id_pct?.abs?.maxTurn)}</span>
              <span className="text-gray-500">minTurn</span><span>{fmt6(data.strValues?.id_pct?.abs?.minTurn)}</span>
            </div>
          </div>

          {/* FM (IDHR) */}
          <div className="rounded-2xl p-4 shadow bg-white/70 md:col-span-3">
            <div className="text-xs text-gray-400 mb-2">General Floating Mode (IDHR)</div>
            <div className="text-sm grid grid-cols-4 gap-y-1 font-mono">
              <span className="text-gray-500">gfm</span><span>{fmt6((data.fm as any)?.gfm)}</span>
              <span className="text-gray-500">confidence</span><span>{fmt6((data.fm as any)?.confidence)}</span>
              <span className="text-gray-500">inertia</span><span>{fmt6((data.fm as any)?.inertia)}</span>
              <span className="text-gray-500">disruption</span><span>{fmt6((data.fm as any)?.disruption)}</span>
              <span className="text-gray-500">σ</span><span>{fmt6((data.fm as any)?.sigmaGlobal)}</span>
              <span className="text-gray-500">vInner</span><span>{fmt6((data.fm as any)?.vInner)}</span>
              <span className="text-gray-500">vOuter</span><span>{fmt6((data.fm as any)?.vOuter)}</span>
            </div>

            {/* Nuclei */}
            <div className="mt-3">
              <div className="text-xs text-gray-400 mb-1">nuclei (top)</div>
              <div className="text-xs font-mono grid grid-cols-5 gap-2">
                <span className="text-gray-500">rank</span>
                <span className="text-gray-500">idhr</span>
                <span className="text-gray-500">ior</span>
                <span className="text-gray-500">μ</span>
                <span className="text-gray-500">z</span>
                {(data.fm?.nuclei ?? []).slice(0, 6).map((n, i) => (
                  <React.Fragment key={i}>
                    <span>{i+1}</span>
                    <span>{n?.key?.idhr ?? "–"}</span>
                    <span>{n?.key?.ior ?? "–"}</span>
                    <span>{fmt6(n?.mu)}</span>
                    <span>{fmt6(n?.z)}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>

        </div>
      )}

      {!loading && !error && !data && (
        <div className="text-sm text-gray-500">no data yet — waiting first window…</div>
      )}
    </div>
  );
}
