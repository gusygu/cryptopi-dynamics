"use client";
import "./globals.css";
import { useCallback, useEffect, useRef, useState } from "react";
import StatusCard from "@/components/StatusCard";
import TimerBar from "@/components/TimeBar";
import Legend from "@/components/Legend";
import Matrix from "@/components/Matrix";
import MeaAuxCard from "@/auxiliary/mea_aux/ui/MeaAuxCard";
import CinAuxTable from "@/auxiliary/cin-aux/ui/CinAuxTable";

type TsKeys = "benchmark" | "delta" | "pct24h" | "id_pct" | "pct_drv";
type Flags = { frozen: boolean[][] } | null;
type MatricesResp = {
  ok: boolean;
  coins: string[];
  ts: Record<TsKeys, number | null>;
  prevTs?: Record<TsKeys, number | null>;
  matrices: Record<TsKeys, (number | null)[][] | null>;
  flags: Record<TsKeys, Flags | null>;
};

const APP_SESSION_ID = "dev-session";

export default function Page() {
  const [data, setData] = useState<MatricesResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cinTs, setCinTs] = useState<number | null>(null);

  const lastRenderedTsRef = useRef<number | null>(null);
  const lastGateSeenAtRef = useRef<number>(0);

  const maxTs = (ts?: Record<TsKeys, number | null>) =>
    !ts ? null : (Object.values(ts).filter(Boolean) as number[]).reduce((a, b) => Math.max(a, b), 0) || null;

  const fetchStatus = async () => {
    await fetch(`/api/status?appSessionId=${encodeURIComponent(APP_SESSION_ID)}&t=${Date.now()}`, {
      cache: "no-store",
    }).catch(() => {});
  };

  const kickPipeline = async () => {
    // visible log in Network & server console
    try {
      const r = await fetch(`/api/pipeline/run-once?t=${Date.now()}`, { method: "POST", cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      console.log("[ui] pipeline/run-once →", j);
    } catch {}
  };

  const fetchMatricesLatest = async () => {
    try {
      const url = `/api/matrices/latest?appSessionId=${encodeURIComponent(APP_SESSION_ID)}&t=${Date.now()}`;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`matrices/latest ${r.status}`);
      const j = (await r.json()) as MatricesResp;

      const gateTs = maxTs(j.ts);
      const now = Date.now();

      if (gateTs && gateTs !== lastRenderedTsRef.current) {
        lastRenderedTsRef.current = gateTs;
        lastGateSeenAtRef.current = now;
        setData(j);
      } else if (!gateTs || now - (lastGateSeenAtRef.current || 0) > 60_000) {
        // stale (>60s) or empty → kick a one-off build then try again next tick
        await kickPipeline();
        lastGateSeenAtRef.current = now; // throttle kicks
      }
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  };

  const fetchCinLatest = async () => {
    try {
      const r = await fetch(
        `/api/cin-aux/latest?appSessionId=${encodeURIComponent(APP_SESSION_ID)}&t=${Date.now()}`,
        { cache: "no-store" }
      );
      const j = await r.json();
      setCinTs(typeof j?.cycleTs === "number" ? j.cycleTs : null);
    } catch {
      setCinTs(null);
    }
  };

  useEffect(() => {
    // first tick
    fetchStatus();
    fetchMatricesLatest();
    fetchCinLatest();
    // 5s heartbeat; UI only updates when gateTs advances (~40s)
    const id = setInterval(() => {
      fetchStatus();
      fetchMatricesLatest();
      fetchCinLatest();
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const getCycleTs = useCallback(() => (cinTs ?? Date.now()), [cinTs]);

  const coins = data?.coins ?? [];
  const mats = data?.matrices;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4">
      <header className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">Dynamics — Matrices</h1>
        <button
          className="ml-auto rounded-md bg-indigo-600/80 hover:bg-indigo-500 px-3 py-1.5 text-xs"
          onClick={kickPipeline}
          title="Trigger one writer pass (dev)"
        >
          Force build (dev)
        </button>
      </header>

      <StatusCard />
      <TimerBar />
      <Legend />

      {err && <div className="text-red-300 mb-2">Error: {err}</div>}

      {mats ? (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
          {/* Left column */}
          <div className="space-y-4">
            <Matrix title="Benchmark (A/B)" coins={coins} grid={mats.benchmark!} flags={data!.flags.benchmark} kind="abs" ts={data!.ts.benchmark} />
            <Matrix title="Δ (A/B)"         coins={coins} grid={mats.delta!}     flags={data!.flags.delta}     kind="abs" ts={data!.ts.delta} />
          </div>
          {/* Middle column */}
          <div className="space-y-4">
            <Matrix title="%24h (A/B)"      coins={coins} grid={mats.pct24h!}    flags={data!.flags.pct24h}    kind="pct" ts={data!.ts.pct24h} />
            <Matrix title="id_pct"          coins={coins} grid={mats.id_pct!}    flags={data!.flags.id_pct}    kind="abs" ts={data!.ts.id_pct} />
          </div>
          {/* Right column */}
          <div className="space-y-4">
            <Matrix title="pct_drv"         coins={coins} grid={mats.pct_drv!}   flags={data!.flags.pct_drv}   kind="abs" ts={data!.ts.pct_drv} flipOverlay />
            <MeaAuxCard coins={coins} defaultK={7} />
          </div>
          {/* CIN full width */}
          <div className="rounded-2xl bg-slate-800/60 p-3 text-[12px] text-slate-200 border border-slate-700/30 md:col-span-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-slate-300 font-semibold">CIN Auxiliary</div>
              <div className="text-slate-400 text-xs">appSession: {APP_SESSION_ID} • cycleTs: {cinTs ?? "—"}</div>
            </div>
            <CinAuxTable appSessionId={APP_SESSION_ID} getCycleTs={getCycleTs} />
          </div>
        </div>
      ) : (
        <div className="text-slate-400">Loading matrices…</div>
      )}
    </div>
  );
}
