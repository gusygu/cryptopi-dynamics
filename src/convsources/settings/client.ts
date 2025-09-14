// src/lib/settings/client.ts
"use client";

import { useEffect, useState } from "react";
import type { AppSettings } from "@/lib/settings/schema";

// Simple fetcher (no SWR dependency to keep it light)
export async function fetchClientSettings(): Promise<AppSettings> {
  const res = await fetch("/api/settings", { cache: "no-store" });
  if (!res.ok) throw new Error(`GET /api/settings ${res.status}`);
  return (await res.json()) as AppSettings;
}

/** React hook to read settings on the client (matrices UI, etc.) */
export function useSettings() {
  const [data, setData] = useState<AppSettings | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await fetchClientSettings();
        if (alive) setData(s);
      } catch (e: any) {
        if (alive) setError(e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  return { data, error, loading };
}

/** Convenience selector for coin universe (guarantees USDT present) */
export function selectCoins(s?: AppSettings | null): string[] {
  const list = s?.coinUniverse ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of list) {
    const u = String(c || "").trim().toUpperCase();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  if (!seen.has("USDT")) out.push("USDT");
  return out;
}
