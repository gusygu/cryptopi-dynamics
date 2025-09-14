// src/app/dynamics/page.tsx
"use client";

import { useState, useMemo } from "react";
import HomeBar from "@/components/HomeBar";
import TimerBar from "@/components/TimeBar";
import AuxUI from "@/components/AuxUi"; // if your file is named AuxUi.tsx, change the import to "@/components/AuxUi"
import { useCoinsUniverse } from "@/lib/dynamicsClient";

export default function DynamicsPage() {
  const coins = useCoinsUniverse();
  const [showClocks, setShowClocks] = useState(true);
  const [base, setBase]   = useState<string>(() => coins[0] ?? "BTC");
  const [quote, setQuote] = useState<string>(() => coins[1] ?? "ETH");

  // keep pair valid when coins change
  useMemo(() => {
    if (!coins.includes(base))  setBase(coins[0] ?? "BTC");
    if (!coins.includes(quote)) setQuote(coins[1] ?? coins[0] ?? "ETH");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coins.join("|")]);

  return (
    <div className="w-full min-h-dvh">
      <HomeBar onToggleClocks={() => setShowClocks((s) => !s)} className="mb-3 cp-card" />
      {showClocks && <TimerBar />}

      <div className="cp-maxw px-4 lg:px-6 space-y-4">
        {/* Pair picker */}
        <div className="cp-card">
          <div className="mb-2 text-sm text-zinc-200">Select pair</div>
          <div className="grid grid-cols-2 gap-3">
            <Picker label="Base"  coins={coins} value={base}  onChange={setBase}  />
            <Picker label="Quote" coins={coins} value={quote} onChange={(c) => setQuote(c === base ? quote : c)} />
          </div>
        </div>

        {/* Auxiliaries (self-fetching MEA + STR, preview-aware) */}
        <AuxUI coins={coins} base={base} quote={quote} className="cp-card" />
      </div>
    </div>
  );
}

function Picker({
  label, coins, value, onChange,
}: { label: string; coins: string[]; value: string; onChange: (c: string) => void }) {
  return (
    <div>
      <div className="text-xs text-zinc-400 mb-1">{label}</div>
      <div className="flex flex-wrap gap-2">
        {coins.map((c) => {
          const active = c === value;
          return (
            <button
              key={`${label}-${c}`}
              onClick={() => onChange(c)}
              className={`px-3 py-1.5 text-xs rounded-md border transition ${
                active
                  ? "bg-emerald-600/25 text-emerald-100 border-emerald-500/30"
                  : "bg-zinc-800/40 text-zinc-100 border-zinc-600/40 hover:bg-zinc-700/50"
              }`}
            >
              {c}
            </button>
          );
        })}
      </div>
    </div>
  );
}
