"use client";
import "./globals.css";
import { useCallback, useEffect, useRef, useState } from "react";
import StatusCard from "@/components/StatusCard";
import TimerBar from "@/components/TimeBar";
import PollerBadge from "@/lab/legacy/PollerBadge";
import { subscribe as subscribePoller, setFetching, setLastOkTs } from "@/lib/pollerClient";
import Legend from "@/components/Legend";
import Matrix from "@/components/Matrix";
import MeaAuxCard from "@/auxiliary/mea_aux/ui/MeaAuxCard";
import CinAuxTable from "@/auxiliary/cin-aux/ui/CinAuxTable";

// ... (types kept as-is)

const APP_SESSION_ID = "dev-session";

export default function Page() {
  // ... (state + refs kept as-is)

  // fetchMatricesLatest: (add) setLastOkTs when gateTs advances
  // inside fetchMatricesLatest success block:
  //   setData(j);
  //   if (gateTs) setLastOkTs(gateTs);

  useEffect(() => {
    // initial fetch on mount + every 40s tick/refresh
    const doAll = async () => {
      setFetching(true);
      await Promise.all([fetchStatus(), fetchMatricesLatest(), fetchCinLatest()]).catch(() => {});
      setFetching(false);
    };
    doAll();

    const unsub = subscribePoller((ev) => {
      if (ev.type === "tick40" || ev.type === "refresh") {
        doAll();
      }
    });
    return () => { unsub(); };
  }, []);

  // ... (rest unchanged)

  return (
    <div className="p-4 md:p-6">
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

      <div className="flex items-center gap-3 mb-2"><PollerBadge /></div>
      <StatusCard />
      <TimerBar />
      <Legend />

      {/* ...rest of your page stays the same */}
    </div>
  );
}
