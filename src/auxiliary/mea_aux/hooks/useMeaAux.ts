"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { subscribe } from "@/lib/pollerClient";

export type MeaGrid = Record<string, Record<string, number | null>>;
export type MeaResp = { ok: boolean; coins: string[]; k: number; grid: MeaGrid; meta?: { warnings?: string[] } };

export type UseMeaAuxOpts = { coins?: string[]; k?: number; refreshMs?: number };

function parseCoinsEnv(): string[] | undefined {
  const raw = process.env.NEXT_PUBLIC_COINS ?? "";
  const arr = raw.split(",").map(s => s.trim()).filter(Boolean);
  return arr.length ? arr : undefined;
}

export function useMeaAux(opts: UseMeaAuxOpts = {}) {
  const defaultCoins = useMemo(() => opts.coins ?? parseCoinsEnv(), [opts.coins]);
  const [data, setData] = useState<MeaResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchNow = useCallback(async () => {
    try {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setLoading(true);
      setError(null);

      const coins = (opts.coins ?? defaultCoins ?? []).join(",");
      const k = Number.isFinite(opts.k as any) ? Number(opts.k) : undefined;
      const url = new URL("/api/mea-aux", window.location.origin);
      if (coins) url.searchParams.set("coins", coins);
      if (k != null) url.searchParams.set("k", String(k));
      url.searchParams.set("t", String(Date.now())); // cache-bust

      const r = await fetch(url.toString(), { signal: ac.signal, cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as MeaResp;
      setData(j);
    } catch (e: any) {
      if (e?.name !== "AbortError") setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [opts.coins, defaultCoins, opts.k]);

  // Initial fetch + poller-driven refresh
  useEffect(() => {
    fetchNow();
    const unsub = subscribe((ev) => {
      if (ev.type === "refresh" || ev.type === "tick120" || ev.type === "tick40") {
        fetchNow();
      }
    });
    return () => {
      abortRef.current?.abort();
      unsub();
    };
  }, [fetchNow]);

  return { data, grid: data?.grid, coins: data?.coins ?? [], k: data?.k, loading, error, refresh: fetchNow };
}
