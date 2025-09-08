"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

// Reuse the table we created earlier
const AuxStrategyTable = dynamic(
  () => import("@/lab/legacy/AuxStrategyTable"),
  { ssr: false }
);

type Status = {
  ok?: boolean;
  status?: {
    running: boolean;
    ticks: number;
    lastOk: number | null;
    lastError: string | null;
    cfg: {
      symbol: string;
      base: string;
      quote: string;
      window: "30m" | "1h" | "3h";
      appSessionId: string;
      intervalSec: number;
      klineInterval: string;
      klineLimit: number;
    } | null;
  };
};

type Props = {
  className?: string;
};

export default function StrAuxPanel({ className = "" }: Props) {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [windowKey, setWindowKey] = useState<"30m" | "1h" | "3h">("30m");
  const [session, setSession] = useState("dev-session");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Status["status"] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const qsLatest = useMemo(
    () =>
      `/api/str-aux/latest?base=${symbol.replace(/USDT$/, "")}&quote=USDT&window=${windowKey}&session=${session}`,
    [symbol, windowKey, session]
  );

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/str-aux/ticker/status", { cache: "no-store" });
      const j = (await res.json()) as { ok: boolean; status: Status["status"] };
      setStatus(j.status || null);
    } catch (e: any) {
      setErr(e?.message ?? "status_error");
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const t = setInterval(refreshStatus, 5000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  async function start() {
    setLoading(true);
    setErr(null);
    try {
      const body = {
        symbol,
        window: windowKey,
        appSessionId: session,
        intervalSec: 15,
        klineInterval: "1m",
        klineLimit: 60,
      };
      const res = await fetch("/api/str-aux/ticker/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "start_failed");
      await refreshStatus();
    } catch (e: any) {
      setErr(e?.message ?? "start_error");
    } finally {
      setLoading(false);
    }
  }

  async function stop() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/str-aux/ticker/stop", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "stop_failed");
      await refreshStatus();
    } catch (e: any) {
      setErr(e?.message ?? "stop_error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={`rounded-2xl border border-slate-700 bg-slate-800/40 p-4 ${className}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="flex flex-col">
            <label className="text-xs opacity-70 mb-1">Symbol</label>
            <input
              className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 outline-none"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="BTCUSDT"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs opacity-70 mb-1">Window</label>
            <select
              className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 outline-none"
              value={windowKey}
              onChange={(e) => setWindowKey(e.target.value as "30m" | "1h" | "3h")}
            >
              <option value="30m">30m</option>
              <option value="1h">1h</option>
              <option value="3h">3h</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-xs opacity-70 mb-1">Session</label>
            <input
              className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 outline-none"
              value={session}
              onChange={(e) => setSession(e.target.value)}
              placeholder="dev-session"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              disabled={loading}
              onClick={start}
              className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
            >
              Start
            </button>
            <button
              disabled={loading}
              onClick={stop}
              className="px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50"
            >
              Stop
            </button>
          </div>
        </div>

        <div className="text-xs opacity-80">
          <div>running: <span className={status?.running ? "text-emerald-400" : "text-rose-400"}>
            {String(!!status?.running)}
          </span></div>
          <div>ticks: {status?.ticks ?? 0}</div>
          <div>lastOk: {status?.lastOk ? new Date(status.lastOk).toLocaleTimeString() : "—"}</div>
          {status?.lastError && <div className="text-rose-400">err: {status.lastError}</div>}
        </div>
      </div>

      {err && <div className="mt-3 text-sm text-rose-400">error: {err}</div>}

      <div className="mt-6">
        {/* Preview the latest doc */}
        <AuxStrategyTable
          className="bg-slate-900/50"
          base={symbol.replace(/USDT$/, "")}
          quote="USDT"
          windowKey={windowKey}
          session={session}
          refreshMs={5000}
        />
        <div className="text-xs opacity-60 mt-2">
          latest API: <code className="font-mono">{qsLatest}</code>
        </div>
      </div>
    </section>
  );
}
