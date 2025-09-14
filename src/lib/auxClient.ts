"use client";

import { useEffect, useMemo, useState } from "react";

export type MeaAux = { grid: number[][]; coins: string[]; tierLabel?: string };

export function useMeaAux(coins: string[], Ca?: string, Cb?: string) {
  const [data, setData] = useState<MeaAux | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const coinsKey = useMemo(() => coins.join(","), [coins]);

  useEffect(() => {
    if (!coins.length) return;
    const u = new URL("/api/mea-aux", window.location.origin);
    u.searchParams.set("coins", coinsKey);
    if (Ca) u.searchParams.set("Ca", Ca);
    if (Cb) u.searchParams.set("Cb", Cb);

    let alive = true;
    setLoading(true);
    fetch(u.toString(), { cache: "no-store" })
      .then(r => r.json())
      .then(j => { if (alive) setData({ grid: j?.grid ?? [], coins: j?.coins ?? coins, tierLabel: j?.tierLabel }); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; };
  }, [coinsKey, Ca, Cb]);

  return { data, loading };
}
