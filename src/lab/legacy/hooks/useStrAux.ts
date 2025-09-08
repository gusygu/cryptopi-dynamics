"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Win = "30m" | "1h" | "3h";

export type UseStrategyAuxParams = {
  base: string;
  quote: string;
  win?: Win;
  appSessionId?: string;
  pollMs?: number;          // default 5000
};

export function useStrategyAux({
  base,
  quote,
  win = "30m",
  appSessionId = "default",
  pollMs = 5000,
}: UseStrategyAuxParams) {
  const [loading, setLoading] = useState(true);
  const [error, setErr] = useState<string | null>(null);
  const [cur, setCur] = useState<any | null>(null);
  const [prev, setPrev] = useState<any | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  const url = useMemo(() => {
    const u = new URL("/api/auxi/current", window.location.origin);
    u.searchParams.set("base", (base || "BTC").toUpperCase());
    u.searchParams.set("quote", (quote || "USDT").toUpperCase());
    u.searchParams.set("win", win);
    u.searchParams.set("appSessionId", appSessionId);
    return u.toString();
  }, [base, quote, win, appSessionId]);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;
    const fetchOnce = async () => {
      try {
        const ac = new AbortController();
        const res = await fetch(url, { signal: ac.signal, cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (!alive) return;
        setCur(j?.cur ?? null);
        setPrev(j?.prev ?? null);
        setErr(null);
        setLoading(false);
        setRefreshedAt(Date.now());
      } catch (e: any) {
        if (!alive) return;
        setErr(String(e?.message || e));
        setLoading(false);
      }
    };

    // immediate + interval
    fetchOnce();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(fetchOnce, Math.max(1000, pollMs));

    return () => {
      alive = false;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [url, pollMs]);

  return { loading, error: error ?? undefined, cur, prev, refreshedAt };
}
