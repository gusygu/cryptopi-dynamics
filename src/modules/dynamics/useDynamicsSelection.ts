// src/modules/dynamics/useDynamicsSelection.ts
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSettings } from "@/lib/settings/provider";
import { useCoinsUniverse } from "@/lib/dynamicsClient";

export type Pair = { base: string; quote: string };

function toUpperCoins(list: string[] | undefined | null): string[] {
  return (list ?? []).map((c) => String(c).toUpperCase());
}

export function useDynamicsSelection() {
  const { settings } = useSettings() as any;
  const universe = useCoinsUniverse();

  const coins = useMemo<string[]>(
    () => toUpperCoins(settings?.coinUniverse?.length ? settings.coinUniverse : universe),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [universe.join("|"), JSON.stringify(settings?.coinUniverse ?? [])]
  );

  const [selected, setSelected] = useState<Pair>(() => {
    const B = String(coins?.[0] ?? "BTC").toUpperCase();
    const Q = String((coins?.find((c: string) => c.toUpperCase() !== B) ?? "USDT")).toUpperCase();
    return { base: B, quote: Q };
  });

  // keep selection coherent when universe changes
  useEffect(() => {
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
  }, [coins.join("|")]);

  const candidates = useMemo(
    () => coins.filter((c) => c !== selected.base && c !== selected.quote).slice(0, 12),
    [coins, selected.base, selected.quote]
  );

  return { coins, selected, setSelected, candidates } as const;
}

