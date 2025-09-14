"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { subscribe } from "@/lib/pollerClient";

export type MeaGrid = Record<string, Record<string, number | null>>;
export type MeaResp = {
  ok: boolean;
  coins: string[];
  k: number;
  grid: MeaGrid;
  meta?: { warnings?: string[] };
};

export type UseMeaAuxOpts = {
  coins?: string[];
  k?: number;
  refreshMs?: number;          // interval for auto refresh
};

function parseCoinsEnv(): string[] | undefined {
  const raw = process.env.NEXT_PUBLIC_COINS ?? "";
  const arr = raw.split(",").map(s => s.trim()).filter(Boolean);
  return arr.length ? arr : undefined;
}

export function useMeaAux(opts: UseMeaAuxOpts = {}) {
  const defaultCoins = useMemo(() => opts.coins ?? parseCoinsEnv(), [opts.coins]);

  const [coins, setCoins] = useState<string[] | undefined>(defaultCoins);
  const [k, setK] = useState<number | undefined>(opts.k);

  const [data, setData] = useState<MeaResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [errorObj, setErrorObj] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const started = useRef<boolean>(false);

  const qs = useMemo(() => {
    const sp = new URLSearchParams();
    if (coins && coins.length) sp.set("coins", coins.join(","));
    if (k && k > 0) sp.set("k", String(Math.floor(k)));
    return sp.toString();
  }, [coins, k]);

  const fetchNow = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setErrorObj(null);
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15000);
    try {
      const url = `/api/mea-aux${qs ? `?${qs}` : ""}`;
      const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`${res.status} ${body}`);
      }
      const j = (await res.json()) as MeaResp;
      setData(j);
      setErrorObj(null);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setErr(msg);
      setErrorObj(e instanceof Error ? e : new Error(msg));
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }, [qs]);

  const start = useCallback(() => { started.current = true; }, []);
  const stop = useCallback(() => { started.current = false; }, []);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  // Centralized refresh: follow universal poller
  useEffect(() => {
    fetchNow();
    const unsub = subscribe((ev) => {
      if (ev.type === "tick40" || ev.type === "tick120" || ev.type === "refresh") fetchNow();
    });
    return () => { unsub(); };
  }, [fetchNow]);

  return {
    coins, setCoins,
    k, setK,
    data,
    err,
    error: errorObj,
    loading,
    refresh: fetchNow,
    start, stop,
  };
}
