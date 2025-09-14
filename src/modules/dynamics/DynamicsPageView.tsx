// src/modules/dynamics/DynamicsPageView.tsx
"use client";

import React from "react";
import HomeBar from "@/components/HomeBar";
import DynamicsMatrix from "@/components/DynamicsMatrix";
import AssetsIdentity from "@/components/AssetsIdentity";
import AuxUi from "@/components/AuxUi";
import ArbTable from "@/components/ArbTable";
import { useArbRows } from "@/lib/dynamicsClient";
import { useDynamicsSelection } from "./useDynamicsSelection";


export default function DynamicsPageView() {
  const { coins, selected, setSelected, candidates } = useDynamicsSelection();
  const { rows, loading: rowsLoading } = useArbRows(selected.base, selected.quote, candidates, {
    window: "30m",
    bins: 128,
    sessionId: "dyn",
  });

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <HomeBar className="sticky top-0 z-30 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur" />

      <main className="mx-auto max-w-[1920px] 2xl:max-w-[2100px] p-4 xl:p-6 2xl:p-8 space-y-6">
        {/* Row 1: Matrix + AssetsIdentity */}
        <div className="grid grid-cols-12 gap-4 xl:gap-6 2xl:gap-8">
          <div className="col-span-12 xl:col-span-7 2xl:col-span-8 min-w-0">
            <DynamicsMatrix
              coins={coins}
              base={selected.base}
              quote={selected.quote}
              onSelect={(b, q) => setSelected({ base: b, quote: q })}
              title="Dynamics - MEA Matrix"
            />
          </div>

          <div className="col-span-12 xl:col-span-5 2xl:col-span-4 min-w-0">
            <AssetsIdentity
              base={selected.base}
              quote={selected.quote}
            />
          </div>
        </div>

        {/* Row 2: Auxiliaries + ArbTable */}
        
        <div className="grid grid-cols-12 gap-4 xl:gap-6 2xl:gap-8">
          <div className="col-span-12 xl:col-span-7 2xl:col-span-8 min-w-0">
            <AuxUi
              coins={coins}
              base={selected.base}
              quote={selected.quote}
              onSelectPair={(b, q) => setSelected({ base: b, quote: q })}
            />
          </div>

          <div className="col-span-12 xl:col-span-5 2xl:col-span-4 min-w-0">
            <ArbTable
              Ca={selected.base}
              Cb={selected.quote}
              candidates={candidates}
              rows={rows}
              loading={rowsLoading}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
