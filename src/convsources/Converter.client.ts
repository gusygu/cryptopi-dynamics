// /src/converters/Converter.client.ts
"use client";

import { useEffect, useMemo, useState } from "react";

/* ----------------------------- Types ----------------------------- */

export type DomainVM = {
  Ca: string;
  Cb: string;
  coins: string[];
  wallets?: Record<string, number>;
  matrix?: {
    benchmark?: number[][];
    id_pct?: number[][];
    pct_drv?: number[][];
    mea?: number[][];
  };
  panels?: {
    mea?: { value: number; tier: string };
    cin?: any;
    str?: any;
  };
  rows?: any[];
};

type VmResponse = { ok: boolean; vm?: DomainVM; error?: string };

/* ------------------------------ Hook ------------------------------ */

export function useDomainVM(
  Ca: string,
  Cb: string,
  coins: string[],
  candidates: string[]
) {
  const [vm, setVM] = useState<DomainVM | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const coinsKey = useMemo(() => coins.join(","), [coins]);
  const candsKey = useMemo(() => candidates.join(","), [candidates]);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const url = new URL("/api/converter/vm", window.location.origin);
        url.searchParams.set("Ca", Ca.toUpperCase());
        url.searchParams.set("Cb", Cb.toUpperCase());
        if (coins.length)      url.searchParams.set("coins",      coins.map(c => c.toUpperCase()).join(","));
        if (candidates.length) url.searchParams.set("candidates", candidates.map(c => c.toUpperCase()).join(","));
        url.searchParams.set("t", String(Date.now()));

        const r = await fetch(url.toString(), { cache: "no-store", signal: ac.signal });
        if (!r.ok) throw new Error(`/api/converter/vm HTTP ${r.status}`);
        const j = (await r.json()) as VmResponse;
        if (!j.ok || !j.vm) throw new Error(j.error ?? "vm error");
        setVM(j.vm);
      } catch (e: any) {
        if (!ac.signal.aborted) {
          setError(e?.message ?? String(e));
          setVM(null);
        }
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [Ca, Cb, coinsKey, candsKey]);

  return { vm, loading, error } as const;
}

/* ------------------------------ Mappers ------------------------------ */

export function toMatrix(vm: DomainVM | null) {
  const m = vm?.matrix ?? {};
  return {
    benchmark: m.benchmark ?? [],
    id_pct:    m.id_pct    ?? [],
    drv:       m.pct_drv   ?? [],
    mea:       m.mea       ?? [],   // ← MEA for numbers
  };
}

export function toArbTableInput(vm: DomainVM | null) {
  return {
    rows:    vm?.rows    ?? [],
    wallets: vm?.wallets ?? {},
  };
}

export function toMetricsPanel(vm: DomainVM | null) {
  return {
    mea: { value: Number(vm?.panels?.mea?.value ?? 0), tier: String(vm?.panels?.mea?.tier ?? "—") },
    cin: (vm?.panels as any)?.cin ?? {},
    str: (vm?.panels as any)?.str ?? {},
  };
}

/* ----------------------------- Helpers ----------------------------- */

export function cell(
  g: number[][] | undefined,
  coins: string[] | undefined,
  a: string | undefined,
  b: string | undefined
): number | undefined {
  if (!g || !coins || !a || !b) return undefined;
  const i = coins.indexOf(a);
  const j = coins.indexOf(b);
  if (i < 0 || j < 0) return undefined;
  return g[i]?.[j];
}
