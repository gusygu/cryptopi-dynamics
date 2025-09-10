"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "@/lib/settings/provider";

type CinRow = {
  symbol: string;
  wallet?: number;
  profit?: number;
  imprint_session?: number;
  imprint_cycle?: number;
  luggage_session?: number;
  luggage_cycle?: number;
};

type CinLatestResp = {
  ok?: boolean;
  rows?: CinRow[];
  ts?: number;
  appSessionId?: string;
};

export default function CinAuxPanel({
  title = "CIN Auxiliary",
  clusterCoins,
  applyCluster = false,
}: {
  title?: string;
  clusterCoins?: string[] | null;
  applyCluster?: boolean;
}) {
  const { settings } = useSettings();

  // timing from settings
  const baseMs = Math.max(500, Number(settings.timing?.autoRefreshMs ?? 40_000));
  const secondaryEnabled = !!settings.timing?.secondaryEnabled;
  const secondaryCycles = Math.max(1, Math.min(10, Number(settings.timing?.secondaryCycles ?? 3)));

  // coins from settings unless cluster forced
  const universe = useMemo(() => settings.coinUniverse ?? [], [settings.coinUniverse]);
  const coins = useMemo(
    () => (applyCluster && clusterCoins?.length ? clusterCoins : universe),
    [applyCluster, clusterCoins, universe]
  );

  const [data, setData] = useState<CinLatestResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetcher = useCallback(async () => {
    try {
      setLoading(true);
      setErr(null);
      const url = new URL("/api/cin-aux/latest", window.location.origin);
      url.searchParams.set("t", String(Date.now()));
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as CinLatestResp;
      setData(j);
    } catch (e: any) {
      setErr(String(e?.message || e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetcher();
    const id = setInterval(fetcher, baseMs);
    return () => clearInterval(id);
  }, [fetcher, baseMs]);

  // secondary loop
  const cyclesRef = useRef(0);
  useEffect(() => {
    if (!secondaryEnabled) return;
    cyclesRef.current = 0;
    const id = setInterval(async () => {
      cyclesRef.current++;
      if (cyclesRef.current % secondaryCycles === 0) await fetcher();
    }, baseMs);
    return () => clearInterval(id);
  }, [secondaryEnabled, secondaryCycles, baseMs, fetcher]);

  // filter rows to selector/cluster coins
  const all = data?.rows ?? [];
  const setCoins = new Set(coins);
  const rows = all.filter((r) => setCoins.has((r.symbol || "").toUpperCase()));

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-300">{title}</div>
        <div className="text-xs text-slate-500">
          {loading ? "Loading…" : err ? `Error: ${err}` : data?.ts ? `ts: ${new Date(data.ts).toLocaleTimeString()}` : "—"}
        </div>
      </div>

      <div className="overflow-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-slate-400">
              <th className="text-left px-2 py-2">Symbol</th>
              <th className="text-right px-2 py-2">Wallet (USDT)</th>
              <th className="text-right px-2 py-2">Profit (USDT)</th>
              <th className="text-right px-2 py-2">Imprint (session)</th>
              <th className="text-right px-2 py-2">Luggage (session)</th>
              <th className="text-right px-2 py-2">Imprint (cycle)</th>
              <th className="text-right px-2 py-2">Luggage (cycle)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((r) => (
                <tr key={r.symbol} className="border-t border-slate-800">
                  <td className="px-2 py-1 font-semibold">{r.symbol}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">{(r.wallet ?? 0).toFixed(2)}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">{(r.profit ?? 0).toFixed(2)}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">{(r.imprint_session ?? 0).toFixed(0)}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">{(r.luggage_session ?? 0).toFixed(0)}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">{(r.imprint_cycle ?? 0).toFixed(0)}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">{(r.luggage_cycle ?? 0).toFixed(0)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-2 py-6 text-center text-slate-400">
                  no CIN rows for this cycle/session yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
