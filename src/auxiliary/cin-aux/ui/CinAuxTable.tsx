'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

type Row = {
  symbol: string;
  wallet_usdt: number;
  profit_usdt: number;
  session_imprint: number;
  session_luggage: number;
  cycle_imprint: number;
  cycle_luggage: number;
};

type ApiResp = {
  ok: boolean;
  coins: string[];
  rows: Row[];
  error?: string;
  ts?: number;
};

function usd(n: number | null | undefined, d = 2) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

export default function CinAuxTable({
  title = 'CIN-AUX',
  clusterCoins = [],
  autoRefreshMs = 45_000,
}: {
  title?: string;
  clusterCoins?: string[];
  autoRefreshMs?: number;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ts, setTs] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Coins to request: if provided, we pin to these; else the API will use Settings
  const coinsQS = useMemo(() => {
    const arr = (clusterCoins ?? []).map(s => String(s).toUpperCase()).filter(Boolean);
    return arr.length ? `?coins=${encodeURIComponent(arr.join(','))}` : '';
  }, [clusterCoins.join(',')]);

  async function fetchOnce(signal?: AbortSignal) {
    setErr(null);
    try {
      // 🔁 IMPORTANT: this is the new endpoint
      const r = await fetch(`/api/cin-aux${coinsQS}`, { cache: 'no-store', signal });
      const j = (await r.json()) as ApiResp;
      if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      setRows(Array.isArray(j.rows) ? j.rows : []);
      setTs(j.ts ?? null);
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setErr(String(e?.message ?? e));
      setRows([]); // show empty state when endpoint fails
    }
  }

  useEffect(() => {
    const ac = new AbortController();
    fetchOnce(ac.signal);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => fetchOnce(ac.signal), Math.max(10_000, autoRefreshMs));
    return () => { ac.abort(); if (timer.current) clearInterval(timer.current); };
  }, [coinsQS, autoRefreshMs]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="text-sm font-semibold text-slate-200">{title}</div>
        <div className="text-xs text-slate-400">{err ? `Error: ${err}` : ts ? new Date(ts).toLocaleTimeString() : ''}</div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-slate-300">
              <th className="px-4 py-2 text-left">Symbol</th>
              <th className="px-4 py-2 text-left">Wallet (USDT)</th>
              <th className="px-4 py-2 text-left">Profit (USDT)</th>
              <th className="px-4 py-2 text-left">Imprint (session)</th>
              <th className="px-4 py-2 text-left">Luggage (session)</th>
              <th className="px-4 py-2 text-left">Imprint (cycle)</th>
              <th className="px-4 py-2 text-left">Luggage (cycle)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-center text-sky-300/80" colSpan={7}>
                  no CIN rows for this cycle/session yet
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.symbol} className="border-t border-slate-800/60">
                  <td className="px-4 py-2 font-mono">{r.symbol}</td>
                  <td className="px-4 py-2">{usd(r.wallet_usdt)}</td>
                  <td className="px-4 py-2">{usd(r.profit_usdt)}</td>
                  <td className="px-4 py-2">{usd(r.session_imprint)}</td>
                  <td className="px-4 py-2">{usd(r.session_luggage)}</td>
                  <td className="px-4 py-2">{usd(r.cycle_imprint)}</td>
                  <td className="px-4 py-2">{usd(r.cycle_luggage)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
