// src/app/dynamics/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import HomeBar from "@/components/HomeBar";
import DynamicsMatrix from "@/components/DynamicsMatrix";
import AssetsIdentity from "@/components/AssetsIdentity";
import AuxUi from "@/components/AuxUi";
import ArbTable, { type ArbRow } from "@/components/ArbTable";

import { useSettings } from "@/lib/settings/provider";
import { useCoinsUniverse } from "@/lib/dynamicsClient";

export default function DynamicsPage() {
  /* --------------------------- Coins & selection --------------------------- */
  const { settings } = useSettings() as any;
  const universe = useCoinsUniverse(); // comes from Settings/ENV fallback

  // initial pair from settings (if any) or first two coins
  const [selected, setSelected] = useState<{ base: string; quote: string }>(() => {
    const coins = (settings?.coinUniverse?.length ? settings.coinUniverse : universe) as string[];
    const B = String(coins?.[0] ?? "BTC").toUpperCase();
    const Q = String((coins?.find((c: string) => c.toUpperCase() !== B) ?? "USDT")).toUpperCase();
    return { base: B, quote: Q };
  });

  // keep selection coherent when universe changes
  useEffect(() => {
    const coins = (settings?.coinUniverse?.length ? settings.coinUniverse : universe) as string[];
    const B = selected.base?.toUpperCase();
    let Q = selected.quote?.toUpperCase();
    if (!coins.includes(B)) {
      const nb = String(coins?.[0] ?? "BTC").toUpperCase();
      const nq = String(coins?.find((c: string) => c.toUpperCase() !== nb) ?? "USDT").toUpperCase();
      setSelected({ base: nb, quote: nq });
      return;
    }
    if (B === Q) {
      const alt = coins.find((c: string) => c.toUpperCase() !== B);
      if (alt) Q = String(alt).toUpperCase();
      setSelected((old) => (old.base === B && old.quote === Q ? old : { base: B, quote: Q }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universe.join("|"), JSON.stringify(settings?.coinUniverse ?? [])]);

  const coins = useMemo<string[]>(
    () => (settings?.coinUniverse?.length ? settings.coinUniverse : universe).map((c: string) => c.toUpperCase()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [universe.join("|"), JSON.stringify(settings?.coinUniverse ?? [])]
  );

  // candidates for ArbTable = top N excluding base/quote (adapter will feed rows later)
  const candidates = useMemo(
    () => coins.filter((c) => c !== selected.base && c !== selected.quote).slice(0, 12),
    [coins, selected.base, selected.quote]
  );

  /* ------------------------------- Page UI ------------------------------- */
  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <HomeBar className="sticky top-0 z-30" />

      <main className="mx-auto max-w-[1800px] p-4 lg:p-6 space-y-6">
        {/* Row 1: Matrix + AssetsIdentity */}
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 xl:col-span-7">
            <DynamicsMatrix
              coins={coins}
              base={selected.base}
              quote={selected.quote}
              onSelect={(b, q) => setSelected({ base: b, quote: q })}
              autoRefreshMs={40_000}
              title="Dynamics — MEA Matrix"
            />
          </div>

          <div className="col-span-12 xl:col-span-5">
            <AssetsIdentity
              base={selected.base}
              quote={selected.quote}
              // wallets are optional; wire getAccountBalances later into a hook and pass here
              autoRefreshMs={40_000}
            />
          </div>
        </div>

        {/* Row 2: Auxiliaries + ArbTable */}
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 xl:col-span-7">
            <AuxUi
              coins={coins}
              base={selected.base}
              quote={selected.quote}
              onSelectPair={(b, q) => setSelected({ base: b, quote: q })}
            />
          </div>

          <div className="col-span-12 xl:col-span-5">
            <ArbTable
              Ca={selected.base}
              Cb={selected.quote}
              candidates={candidates}
              // TODO: plug real rows from STR adapter (next sprint).
              rows={EMPTY_ROWS(candidates)}
              loading={false}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

/* ------------------------- temporary stub adapter ------------------------- */
/** Produce empty rows so the ArbTable renders while we wire STR adapter next. */
function EMPTY_ROWS(cands: string[]): ArbRow[] {
  return cands.map((ci) => ({
    ci,
    cols: {
      cb_ci: { benchmark: NaN, id_pct: NaN, vTendency: NaN, swapTag: { count: 0, direction: "frozen" } },
      ci_ca: { benchmark: NaN, id_pct: NaN, vTendency: NaN, swapTag: { count: 0, direction: "frozen" } },
      ca_ci: { benchmark: NaN, id_pct: NaN, vTendency: NaN, swapTag: { count: 0, direction: "frozen" } },
    },
  }));
}
