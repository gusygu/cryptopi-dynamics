// src/converters/Converter.client.ts
// CLIENT-ONLY: React hook to fetch the VM from the API + light mappers
"use client";

import { useEffect, useState } from "react";
import type { DomainVM } from "@/converters/provider.types";

export function useDomainVM(
  Ca: string,
  Cb: string,
  coins: string[],
  candidates: string[]
) {
  const [vm, setVm] = useState<DomainVM | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams({
      Ca,
      Cb,
      coins: coins.join(","),
      candidates: candidates.join(","),
    });
    setLoading(true);
    setError(null);
    fetch(`/api/converter/vm?${qs.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (!alive) return;
        if (json?.error) {
          setError(String(json.error));
          setVm(null);
        } else {
          setVm(json as DomainVM);
        }
      })
      .catch((e) => {
        if (!alive) return;
        setError(String(e?.message || e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [Ca, Cb, coins.join("|"), candidates.join("|")]);

  return { vm, loading, error } as const;
}

// UI mappers (keep UI decoupled from provider shapes)
export function toArbTableInput(vm: DomainVM) {
  return vm.arb;
}
export function toMatrix(vm: DomainVM) {
  return vm.matrix;
}
export function toMetricsPanel(vm: DomainVM) {
  return vm.metricsPanel;
}
