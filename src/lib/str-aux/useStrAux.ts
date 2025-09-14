"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Minimal shape — extend safely if your API returns more
export type StrAuxData = {
  ok: boolean;
  pair: string;
  shift_stamp?: boolean;
  gfmDelta?: { vTendency?: number; vShift?: number; vInner?: number; vOuter?: number };
  fm?: { sigma?: number; nuclei?: { id: string; weight: number }[] };
  lastUpdateTs?: number; // graceful if API omits it
};

type UseStrAuxOpts = {
  pair: string;                        // e.g. "ETHUSDT" or "ETHBTC"
  auto?: boolean;                      // default true
  refreshMs?: number;                  // default from settings or 20_000
};

async function fetchStrAux(pair: string): Promise<StrAuxData> {
  // Try both likely endpoints; first that resolves OK wins
  const urls = [
    `/api/str-aux?pair=${encodeURIComponent(pair)}`,
    `/str-aux/api?pair=${encodeURIComponent(pair)}`,
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u, { cache: "no-store" });
      if (r.ok) return (await r.json()) as StrAuxData;
    } catch {}
  }
  return { ok: false, pair };
}

export function useStrAux({ pair, auto = true, refreshMs }: UseStrAuxOpts) {
  const [data, setData] = useState<StrAuxData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const tick = useRef<number | null>(null);

  // Try to read your settings shape if present on window
  const defaultMs = useMemo(() => {
    try {
      // @ts-ignore
      const s = typeof window !== "undefined" ? window.__APP_SETTINGS__ : undefined;
      const ms = s?.timing?.autoRefreshMs;
      return typeof ms === "number" && ms > 1000 ? ms : 20000;
    } catch {
      return 20000;
    }
  }, []);
  const cadence = refreshMs ?? defaultMs;

  const run = async () => {
    if (!pair) return;
    setLoading(true);
    setError(null);
    try {
      const d = await fetchStrAux(pair);
      if (!d.ok) throw new Error("str-aux not ok");
      setData(d);
    } catch (e: any) {
      setError(e?.message ?? "fetch failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    run();
    if (auto) {
      tick.current = window.setInterval(run, cadence) as unknown as number;
      return () => {
        if (tick.current) window.clearInterval(tick.current);
      };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair, auto, cadence]);

  return { data, error, loading, refresh: run };
}
