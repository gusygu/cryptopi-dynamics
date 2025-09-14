// src/lib/walletClient.ts
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { subscribe as subPoller, PollerEvent } from "@/lib/pollerClient";

export type WalletsMap = Record<string, number>;

async function fetchWallets(): Promise<WalletsMap> {
  try {
    const r = await fetch("/api/providers/binance/wallet", { cache: "no-store" });
    if (!r.ok) return {};
    const j = await r.json();
    return (j?.wallets ?? {}) as WalletsMap;
  } catch {
    return {};
  }
}

export function useWallets() {
  const [wallets, setWallets] = useState<WalletsMap>({});
  const inflight = useRef<boolean>(false);

  const load = async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const w = await fetchWallets();
      setWallets(w);
    } finally {
      inflight.current = false;
    }
  };

  useEffect(() => {
    // initial
    load();
    // re-fetch on each 40s tick or manual refresh
    const unsub = subPoller((ev: PollerEvent) => {
      if (ev.type === "tick40" || ev.type === "refresh") load();
    });
    return () => unsub();
  }, []);

  return wallets;
}

// helpers
export const round3 = (n?: number) =>
  Number.isFinite(Number(n)) ? Math.round(Number(n) * 1000) / 1000 : 0;

export function selectBalances(
  wallets: WalletsMap,
  base: string,
  quote: string,
  bridge: string = "USDT"
) {
  const b = round3(wallets[base]);
  const q = round3(wallets[quote]);
  const u = round3(wallets[bridge]);
  return { base: b, quote: q, bridge: u };
}
