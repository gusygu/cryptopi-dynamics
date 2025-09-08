// src/lab/aux-str/hooks/useOrderbook.ts
"use client";
/**
 * Placeholder for a 1s-ticker subscription (Binance or your relay).
 * Keep it minimal; you can wire this to your existing orderbook stream later.
 */
import { useEffect, useRef } from "react";
import type { Point } from "@/lab/str-aux/types";

export default function useOrderbook(onPoint: (p: Point) => void) {
  const running = useRef(true);
  useEffect(() => {
    running.current = true;

    // TODO: replace with real stream; this is a dev-ticker
    const id = setInterval(() => {
      if (!running.current) return;
      const now = Date.now();
      const price = 60000 + Math.sin(now / 5000) * 300 + (Math.random() - 0.5) * 40;
      const volume = Math.random() * 10 + 1;
      onPoint({ price, volume, ts: now });
    }, 1000);

    return () => { running.current = false; clearInterval(id); };
  }, [onPoint]);
}
