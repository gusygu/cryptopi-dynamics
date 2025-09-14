// src/lib/dynamicsClient.ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "@/lib/settings/provider";
import { subscribe } from "@/lib/pollerClient";
import { useDomainVM as useConverterVM } from "@/converters/Converter.client";
export type { DomainVM } from "@/converters/Converter.client";

/* ----------------------------- shared contracts ----------------------------- */

export type Coins = string[];
export type Grid = (number | null)[][];
type TsKey = "benchmark" | "pct24h" | "delta" | "id_pct" | "pct_drv";
export type MatricesPayload = {
  ok: boolean;
  coins: string[];
  matrices: Partial<Record<TsKey, Grid>>;
  ts?: Partial<Record<TsKey, number>>;
  flags?: Partial<Record<TsKey, { frozen?: boolean[][]; bridged?: boolean[][] }>>;
};

export type MeaResp = {
  ok: boolean;
  coins: string[];
  k?: number;
  // Server may return: number[][] | {weights:number[][]} | { [base]: { [quote]: number|null } }
  grid?: any;
  meta?: { warnings?: string[] };
};

export type PreviewResp = { ok?: boolean; symbols: string[] };

export type StrBinsOut = {
  ok?: boolean;
  n?: number;
  bins?: number;
  window?: string;
  cards?: {
    opening?: { benchmark?: number; pct24h?: number };
    live?: { benchmark?: number; pct24h?: number; pct_drv?: number };
  };
  fm?: { gfm_ref_price?: number; gfm_calc_price?: number; vInner?: number; vOuter?: number };
  gfmDelta?: { absPct?: number; anchorPrice?: number | null; price?: number };
  swaps?: number;
  shifts?: { nShifts?: number; timelapseSec?: number; latestTs?: number };
  hist?: { counts?: number[] };
  lastUpdateTs?: number;
  error?: string;
};

export type StrBinsResp = {
  ok: boolean;
  symbols: string[];
  out: Record<string, StrBinsOut>;
  window: "30m" | "1h" | "3h" | string;
  ts?: number;
  selected?: string[];
};

/* --------------------------------- helpers --------------------------------- */

const UPPER = (s: string) => String(s || "").trim().toUpperCase();

// Coalesced fetch to avoid piling identical requests during boot/render storms
const _inflight = new Map<string, Promise<any>>();
const _lastAt = new Map<string, number>();
const COALESCE_WINDOW_MS = 300; // collapse identical requests within this window
async function fetchJSON<T>(u: URL, signal?: AbortSignal): Promise<T> {
  const key = u.toString();
  const now = Date.now();
  const last = _lastAt.get(key) || 0;
  if (_inflight.has(key) && now - last < COALESCE_WINDOW_MS) {
    return _inflight.get(key)! as Promise<T>;
  }
  _lastAt.set(key, now);
  const p = (async () => {
    const r = await fetch(key, { cache: "no-store", signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as T;
  })();
  _inflight.set(key, p);
  try { return await p; } finally { _inflight.delete(key); }
}

async function fetchMatricesLatest(coins?: Coins, signal?: AbortSignal): Promise<MatricesPayload> {
  const u = new URL("/api/matrices/latest", window.location.origin);
  if (coins?.length) u.searchParams.set("coins", coins.map(UPPER).join(","));
  return fetchJSON<MatricesPayload>(u, signal);
}

const numOrNull = (x: any) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

/** Convert server MEA grid of *any* recognized shape into a [][] in the given order. */
function toMatrixFromAnyGrid(anyGrid: any, order: string[]): Grid | undefined {
  // 1) Already a 2-D array
  if (Array.isArray(anyGrid) && Array.isArray(anyGrid[0])) {
    return anyGrid as Grid;
  }
  // 2) {weights: number[][]}
  if (anyGrid && Array.isArray(anyGrid.weights) && Array.isArray(anyGrid.weights[0])) {
    return anyGrid.weights as Grid;
  }
  // 3) Object-of-objects keyed by coin symbols
  if (anyGrid && typeof anyGrid === "object") {
    const N = order.length;
    const out: Grid = Array.from({ length: N }, () => Array(N).fill(null));
    for (let i = 0; i < N; i++) {
      const b = order[i];
      const row = anyGrid[b] || anyGrid[b?.toUpperCase()];
      for (let j = 0; j < N; j++) {
        if (i === j) { out[i][j] = null; continue; }
        const q = order[j];
        const raw = row ? (row[q] ?? row[q?.toUpperCase()]) : undefined;
        out[i][j] = numOrNull(raw);
      }
    }
    return out;
  }
  return undefined;
}

/** Extract a numeric matrix from MEA response, honoring coin order. */
export function extractMeaGrid(resp?: MeaResp, order?: string[]): Grid | undefined {
  if (!resp) return undefined;
  // Prefer explicit order, else the response's coin order, else empty
  const coinsOrder = (order && order.length ? order : (resp.coins || [])).map(UPPER);
  return toMatrixFromAnyGrid(resp.grid, coinsOrder);
}

/* --------------------------- coins universe hook --------------------------- */

export function useCoinsUniverse(): Coins {
  const { settings } = useSettings() as any;

  return useMemo(() => {
    const fromSettings: string[] = (settings?.coinUniverse ?? []).map(UPPER).filter(Boolean);
    if (fromSettings.length) return Array.from(new Set(fromSettings));

    const env = process.env.NEXT_PUBLIC_COINS ?? "BTC,ETH,BNB,SOL,ADA,XRP,PEPE,USDT";
    return Array.from(new Set(env.split(",").map(UPPER).filter(Boolean)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify((useSettings() as any)?.settings?.coinUniverse ?? [])]);
}

/* --------------------------------- MEA grid -------------------------------- */

export function useMeaGrid(coins: Coins, opts?: { k?: number }) {
  const [grid, setGrid] = useState<Grid | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!coins?.length) {
      setGrid(undefined);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      setLoading(true);
      setErr(null);
      const u = new URL("/api/mea-aux", window.location.origin);
      u.searchParams.set("coins", coins.map(UPPER).join(","));
      if (opts?.k != null) u.searchParams.set("k", String(opts.k));
      const j = await fetchJSON<MeaResp>(u, ac.signal);
      setGrid(extractMeaGrid(j, coins));
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setErr(String(e?.message || e));
        setGrid(undefined);
      }
    } finally {
      setLoading(false);
    }
  }, [coins, opts?.k]);

  useEffect(() => {
    refresh();
    const unsub = subscribe((ev) => {
      if (ev.type === "tick40" || ev.type === "tick120" || ev.type === "refresh") refresh();
    });
    return () => { unsub(); abortRef.current?.abort(); };
  }, [refresh]);

  return { grid, loading, error, refresh };
}

/* ---------------------------- matrices: latest hook ---------------------------- */
export function useDomainVM(Ca: string, Cb: string, coins: string[], candidates: string[] = []) {
  const uCoins = useMemo(() => coins.map((c) => String(c).toUpperCase()), [coins]);
  const uCands = useMemo(() => candidates.map((c) => String(c).toUpperCase()), [candidates]);
  const { vm, loading, error } = useConverterVM(Ca, Cb, uCoins, uCands);
  return { vm, loading, error } as const;
}

export function useMatricesLatest(coins?: Coins) {
  const key = (coins ?? []).join(",");
  const [data, setData] = useState<MatricesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    // Deduplicate rapid successive refresh calls
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      setLoading(true);
      setErr(null);
      const j = await fetchMatricesLatest(coins, ac.signal);
      setData(j);
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setErr(String(e?.message || e));
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    refresh();
    const unsub = subscribe((ev) => {
      if (ev.type === "tick40" || ev.type === "tick120" || ev.type === "refresh") refresh();
    });
    return () => { unsub(); abortRef.current?.abort(); };
  }, [refresh]);

  return { data, loading, error, refresh } as const;
}

/* ------------------------------ Preview (BIN) ------------------------------ */

export function usePreviewSymbols(coins?: Coins) {
  const key = (coins ?? []).join(",");
  const [symbols, setSymbols] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setErr] = useState<string | null>(null);

  // Module-local coalescing for preview
  const PREVIEW_INFLIGHT: any = (globalThis as any).__PREVIEW_INFLIGHT__ || ((globalThis as any).__PREVIEW_INFLIGHT__ = new Map<string, Promise<any>>());
  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setErr(null);

      const key = `preview:${(coins ?? []).map(UPPER).join(',')}`;
      let p = PREVIEW_INFLIGHT.get(key) as Promise<any> | undefined;
      if (!p) {
        p = (async () => {
          const r = await fetch("/api/preview/symbols", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({ coins: (coins ?? []).map(UPPER) }),
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return (await r.json()) as { ok?: boolean; symbols?: string[] };
        })();
        PREVIEW_INFLIGHT.set(key, p);
      }
      const j = await p;
      setSymbols(((j?.symbols ?? []) as string[]).map(UPPER));
    } catch (e: any) {
      setErr(String(e?.message || e));
      setSymbols([]);
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => { refresh(); }, [refresh]);

  return { symbols, loading, error, refresh } as const;
}

/* ------------------------------- STR bins hook ------------------------------ */

export function useStrAux(...args: any[]) {
  let base = ""; let quote = ""; let enabled = true;
  let opts: { window?: "30m"|"1h"|"3h"; bins?: number; sessionId?: string; allowUnverified?: boolean } | undefined;

  if (typeof args[1] === "string" || args[1] == null) {
    const symIn = String(args[0] || "").toUpperCase();
    enabled = args[1] === undefined ? true : Boolean(args[1]);
    base = symIn.slice(0, Math.max(0, symIn.length - 4));
    quote = symIn.slice(-4);
  } else {
    base = String(args[0] || "").toUpperCase();
    quote = String(args[1] || "").toUpperCase();
    opts = args[2];
  }

  const B = UPPER(base);
  const Q = UPPER(quote);
  const sym = `${B}${Q}`;

  const [data, setData] = useState<StrBinsOut | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled || !B || !Q) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      setLoading(true);
      setErr(null);
      const u = new URL("/api/str-aux/bins", window.location.origin);
      u.searchParams.set("pairs", sym);
      u.searchParams.set("window", opts?.window ?? "30m");
      u.searchParams.set("bins", String(opts?.bins ?? 128));
      u.searchParams.set("sessionId", opts?.sessionId ?? "dyn");
      if (opts?.allowUnverified) u.searchParams.set("allowUnverified", "true");
      const j = await fetchJSON<StrBinsResp>(u, ac.signal);
      setData(j?.out?.[sym]);
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setErr(String(e?.message || e));
        setData(undefined);
      }
    } finally {
      setLoading(false);
    }
  }, [enabled, sym, opts?.window, opts?.bins, opts?.sessionId, opts?.allowUnverified]);

  useEffect(() => {
    refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  // follow global poller ticks to keep data in sync with the app clock
  useEffect(() => {
    const unsub = subscribe((ev) => {
      if (ev.type === "tick40" || ev.type === "tick120" || ev.type === "refresh") {
        refresh();
      }
    });
    return () => { unsub(); };
  }, [refresh]);

  const summary = useMemo(() => {
    const gfmAbsPct = Number(data?.gfmDelta?.absPct ?? 0);
    const vTendency = Number((data?.fm?.vInner ?? 0) - (data?.fm?.vOuter ?? 0));
    const shifts    = Number(data?.shifts?.nShifts ?? 0);
    const swaps     = Number(data?.swaps ?? 0);
    const latestTs  = Number(data?.shifts?.latestTs ?? data?.lastUpdateTs ?? 0);
    const hist      = Array.isArray(data?.hist?.counts) ? (data!.hist!.counts as number[]) : [];
    return { gfmAbsPct, vTendency, shifts, swaps, latestTs, ts: latestTs, hist };
  }, [data]);

  // legacy field name expected by some components
  const metrics = summary;

  return { sym, data, summary, metrics, loading, error, refresh } as const;
}

/* -------------------------- Arb adapter (optional) -------------------------- */
export function buildArbRows(
  Ca: string,
  Cb: string,
  candidates: string[],
  strMap: Record<string, StrBinsOut | undefined>
) {
  const rows = candidates.map((ci) => {
    const CI = UPPER(ci);
    const cb_ci = strMap[`${UPPER(Cb)}${CI}`];
    const ci_ca = strMap[`${CI}${UPPER(Ca)}`];
    const ca_ci = strMap[`${UPPER(Ca)}${CI}`];

    const mk = (s?: StrBinsOut) =>
      s
        ? {
            benchmark: Number(s.cards?.live?.benchmark ?? s.cards?.opening?.benchmark ?? NaN),
            id_pct: Number(s.gfmDelta?.absPct ?? NaN), // placeholder
            vTendency: Number((s.fm?.vInner ?? 0) - (s.fm?.vOuter ?? 0)),
            swapTag: { count: Number(s.swaps ?? 0), direction: "frozen" as const, changedAtIso: s.lastUpdateTs ? new Date(s.lastUpdateTs).toISOString() : undefined },
          }
        : undefined;

    return { ci: CI, cols: { cb_ci: mk(cb_ci), ci_ca: mk(ci_ca), ca_ci: mk(ca_ci) } };
  });

  return rows;
}

// … keep imports …

export function useArbRows(
  Ca: string,
  Cb: string,
  candidates: string[],
  opts?: {
    window?: "30m" | "1h" | "3h";
    bins?: number;
    sessionId?: string;
    allowUnverified?: boolean;   // NEW
    includeReverse?: boolean;    // NEW (defaults true)
  }
) {
  const [rows, setRows] = useState<ReturnType<typeof buildArbRows>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      setLoading(true);
      setErr(null);

      const A = (Ca || "").toUpperCase();
      const B = (Cb || "").toUpperCase();
      const wantReverse = opts?.includeReverse !== false;

      // Collect all required symbols for each candidate:
      //   cb_ci, ci_ca, ca_ci (+ optional reverses to fill gaps in server coverage)
      const syms = new Set<string>();
      for (const ci0 of candidates) {
        const CI = String(ci0 || "").toUpperCase();
        syms.add(`${B}${CI}`); // cb_ci
        syms.add(`${CI}${A}`); // ci_ca
        syms.add(`${A}${CI}`); // ca_ci
        if (wantReverse) {
          syms.add(`${CI}${B}`); // reverse of cb_ci
          syms.add(`${A}${B}`);  // extra leg sometimes needed by UI
          syms.add(`${B}${A}`);  // reverse AB (for pills/headers that peek it)
        }
      }
      if (syms.size === 0) { setRows([]); return; }

      const u = new URL("/api/str-aux/bins", window.location.origin);
      u.searchParams.set("pairs", Array.from(syms).join(","));
      u.searchParams.set("window", opts?.window ?? "30m");
      u.searchParams.set("bins", String(opts?.bins ?? 128));
      u.searchParams.set("sessionId", opts?.sessionId ?? "dyn");
      if (opts?.allowUnverified) u.searchParams.set("allowUnverified", "true"); // NEW

      const j = await fetchJSON<StrBinsResp>(u, ac.signal);
      const out = (j?.out ?? {}) as Record<string, StrBinsOut>;
      const map: Record<string, StrBinsOut | undefined> = {};
      for (const k of Object.keys(out)) map[k] = out[k];

      setRows(buildArbRows(A, B, candidates, map));
    } catch (e: any) {
      if (e?.name !== "AbortError") setErr(String(e?.message || e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [Ca, Cb, candidates.join(","), opts?.window, opts?.bins, opts?.sessionId, opts?.allowUnverified, opts?.includeReverse]);

  useEffect(() => {
    refresh();
    // SUBSCRIBE to the shared poller so the table auto-refreshes
    const unsub = subscribe((ev) => {
      if (ev.type === "tick40" || ev.type === "tick120" || ev.type === "refresh") refresh();
    });
    return () => { unsub(); abortRef.current?.abort(); };
  }, [refresh]);

  return { rows, loading, error, refresh } as const;
}
