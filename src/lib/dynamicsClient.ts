// src/lib/dynamicsClient.ts
"use client";

/**
 * CENTRAL DATA ROUTER (client).
 * - Pure fetchers (HTTP to our API routes)
 * - Poller-aware hooks (subscribe to tick40/tick120/refresh)
 * - Derived selectors (pair market, pct24h)
 * - Re-exports from converter (VM/Arb)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { subscribe } from "@/lib/pollerClient";
import { useSettings } from "@/lib/settings/provider";
import type {
  Coins, Grid, MatricesPayload, MeaResp, PreviewResp, StrBinsResp,
  PairMarket, StrAuxMetrics,
} from "@/lib/dynamics.contracts";

// Re-export converter helpers (so components don't import scattered files)
export { useDomainVM, toArbTableInput, toMetricsPanel } from "@/converters/Converter.client";

/* ───────────── Routes registry ───────────── */
const ROUTES = {
  matricesLatest: "/api/matrices/latest",
  meaAux: "/api/mea-aux",
  preview: "/api/providers/binance/preview",
  strBins: "/api/str-aux/bins",
};

/* ───────────── Small TTL cache ───────────── */
const cache = new Map<string, { ts: number; data: any }>();
const getCached = <T,>(k: string, ttlMs = 1200): T | undefined => {
  const hit = cache.get(k);
  if (!hit) return;
  if (Date.now() - hit.ts > ttlMs) return;
  return hit.data as T;
};
const setCached = <T,>(k: string, data: T) => cache.set(k, { ts: Date.now(), data });
const nowQ = () => ({ t: String(Date.now()) });
const idx = (coins: Coins, c?: string) => (c ? coins.indexOf(c) : -1);

/* ───────────── Pure fetchers ───────────── */
export async function fetchMatricesLatest(coins?: Coins, signal?: AbortSignal): Promise<MatricesPayload> {
  const key = `mat:${(coins ?? []).join(",")}`;
  const hit = getCached<MatricesPayload>(key);
  if (hit) return hit;

  const url = new URL(ROUTES.matricesLatest, window.location.origin);
  if (coins?.length) url.searchParams.set("coins", coins.join(","));
  Object.entries(nowQ()).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url, { cache: "no-store", signal });
  if (!r.ok) throw new Error(`matrices ${r.status}`);
  const j = (await r.json()) as MatricesPayload;
  setCached(key, j);
  return j;
}

export async function fetchMeaGrid(coins: Coins, signal?: AbortSignal): Promise<Grid | undefined> {
  const key = `mea:${coins.join(",")}`;
  const hit = getCached<Grid | undefined>(key);
  if (hit) return hit;

  const url = new URL(ROUTES.meaAux, window.location.origin);
  if (coins?.length) url.searchParams.set("coins", coins.join(","));
  Object.entries(nowQ()).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url, { cache: "no-store", signal });
  if (!r.ok) return undefined;
  const j = (await r.json()) as MeaResp;
  const g = j?.grid;
  setCached(key, g);
  return g;
}

export async function fetchPreviewSymbols(signal?: AbortSignal): Promise<string[]> {
  const key = "preview";
  const hit = getCached<string[]>(key);
  if (hit) return hit;

  const url = new URL(ROUTES.preview, window.location.origin);
  Object.entries(nowQ()).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url, { cache: "no-store", signal });
  if (!r.ok) return [];
  const j = (await r.json()) as PreviewResp;
  const syms = (j?.symbols ?? []).map((s) => s.toUpperCase());
  setCached(key, syms);
  return syms;
}

export async function fetchStrAux(symbol: string, signal?: AbortSignal): Promise<StrBinsResp | undefined> {
  const key = `str:${symbol}`;
  const hit = getCached<StrBinsResp | undefined>(key);
  if (hit) return hit;

  const url = new URL(ROUTES.strBins, window.location.origin);
  url.searchParams.set("pairs", symbol);
  url.searchParams.set("window", "30m"); // TODO: allow settings override
  url.searchParams.set("bins", "128");
  url.searchParams.set("sessionId", "dyn");
  Object.entries(nowQ()).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url, { cache: "no-store", signal });
  if (!r.ok) return undefined;
  const j = (await r.json()) as StrBinsResp;
  setCached(key, j);
  return j;
}

/* ───────────── Hooks: settings → coins ───────────── */
export function useCoinsUniverse(): Coins {
  const { settings } = useSettings() as any;
  const env = (process?.env?.NEXT_PUBLIC_COINS ?? "BTC,ETH,BNB,SOL,ADA,XRP,PEPE,USDT")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  return useMemo(
    () => (settings?.coinUniverse?.length ? settings.coinUniverse : env),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings?.coinUniverse?.join("|")]
  );
}

/* ───────────── Hooks: preview ───────────── */
export function usePreviewSymbols() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const ac = new AbortController();
    try { setLoading(true); setSymbols(await fetchPreviewSymbols(ac.signal)); }
    finally { setLoading(false); ac.abort(); }
  };

  useEffect(() => {
    refresh();
    const unsub = subscribe((ev) => {
      if (ev.type === "tick40" || ev.type === "tick120" || ev.type === "refresh") refresh();
    });
    return () => unsub();
  }, []);

  return { symbols, loading, refresh };
}

/* ───────────── Hooks: MEA ───────────── */
export function useMeaGrid(coins: Coins) {
  const key = coins.join(",");
  const [grid, setGrid] = useState<Grid | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!coins?.length) return;
    const ac = new AbortController();
    try { setLoading(true); setError(null); setGrid(await fetchMeaGrid(coins, ac.signal)); }
    catch (e: any) { setError(e?.message ?? "mea-aux fetch failed"); setGrid(undefined); }
    finally { setLoading(false); ac.abort(); }
  };

  useEffect(() => {
    load();
    const unsub = subscribe((ev) => {
      if (ev.type === "tick40" || ev.type === "tick120" || ev.type === "refresh") load();
    });
    return () => unsub();
  }, [key]);

  return { grid, loading, error, refresh: load };
}

/* ───────────── Hooks: matrices latest ───────────── */
export function useMatricesLatest(coins?: Coins) {
  const key = coins?.join(",") ?? "";
  const [data, setData] = useState<MatricesPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const run = async () => {
    const ac = new AbortController();
    try { setLoading(true); setData(await fetchMatricesLatest(coins, ac.signal)); }
    finally { setLoading(false); ac.abort(); }
  };

  useEffect(() => {
    run();
    const unsub = subscribe((ev) => {
      if (ev.type === "tick40" || ev.type === "tick120" || ev.type === "refresh") run();
    });
    return () => unsub();
  }, [key]);

  return { data, loading };
}

/* ───────────── Hooks: STR-AUX (preview-gated) ───────────── */
export function useStrAux(symbol: string | null, enabled = true) {
  const sym = (symbol ?? "").toUpperCase();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<StrAuxMetrics | null>(null);
  const lastSym = useRef("");

  const run = async () => {
    if (!enabled || !sym) return;
    const ac = new AbortController();
    try {
      setLoading(true); setError(null);
      const j = await fetchStrAux(sym, ac.signal);
      const o = j?.out?.[sym];
      if (!o?.ok) return;
      const vIn = Number(o.fm?.vInner ?? 0);
      const vOut = Number(o.fm?.vOuter ?? 0);
      setMetrics({
        gfmAbsPct: Number(o.gfmDelta?.absPct ?? 0),
        vTendency: vIn - vOut,
        shifts: Number(o.shifts?.nShifts ?? 0),
        swaps: Number(o.swaps ?? 0),
        ts: Number(o?.lastUpdateTs ?? j?.ts) || null,
      });
      lastSym.current = sym;
    } catch (e: any) {
      setError(e?.message ?? "str-aux fetch failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    run();
    const unsub = subscribe((ev) => {
      if (ev.type === "tick40" || ev.type === "tick120" || ev.type === "refresh") run();
    });
    return () => unsub();
  }, [sym, enabled]);

  return { metrics, loading, error, refresh: run, lastSym: lastSym.current };
}

/* ───────────── Derived hooks: Pair market & pct24h ───────────── */
export function usePairMarket(base: string, quote: string) {
  const coins = useCoinsUniverse();
  const { data, loading } = useMatricesLatest(coins);

  const out: PairMarket = useMemo(() => {
    const cs = data?.coins ?? coins;
    const i = idx(cs, base), j = idx(cs, quote), iu = idx(cs, "USDT");
    const bm = data?.matrices?.benchmark;
    const id = data?.matrices?.id_pct;
    const get = (g?: Grid, a?: number, b?: number) => (g && a! >= 0 && b! >= 0 ? Number(g[a!][b!]) : 0);
    return {
      benchmark: get(bm, i, j),
      id_pct:    get(id, i, j),
      bridge: {
        bm: { ca_usdt: get(bm, i, iu), usdt_cb: get(bm, iu, j) },
        id: { ca_usdt: get(id, i, iu), usdt_cb: get(id, iu, j) },
      },
    };
  }, [data?.coins?.join(","), base, quote, data?.matrices, coins.join(",")]);

  return { ...out, loading };
}

export function usePct24h(base: string, quote: string) {
  const coins = useCoinsUniverse();
  const { data, loading } = useMatricesLatest(coins);

  const pct24h = useMemo(() => {
    const cs = data?.coins ?? coins;
    const i = idx(cs, base), j = idx(cs, quote);
    const g = data?.matrices?.pct24h;
    if (!g || i < 0 || j < 0) return null;
    const v = Number(g[i][j]);
    return Number.isFinite(v) ? v : null;
  }, [data?.coins?.join(","), base, quote, data?.matrices?.pct24h, coins.join(",")]);

  return { pct24h, loading };
}

/* ───────────── Wallets (event-driven for now) ───────────── */
export function useWallets() {
  const [wallets, setWallets] = useState<Record<string, number>>({});

  useEffect(() => {
    const onUpd = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail as any;
        if (detail && typeof detail === "object") setWallets(detail);
      } catch { /* noop */ }
    };
    window.addEventListener("wallets:update", onUpd as any);
    return () => window.removeEventListener("wallets:update", onUpd as any);
  }, []);

  return { wallets, loading: false };
}
