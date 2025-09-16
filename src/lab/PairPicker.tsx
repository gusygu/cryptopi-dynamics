// src/components/PairPicker.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Tradable = { symbol: string; base: string; quote: string };
type Props = {
  value?: string;                       // current symbol (e.g., "ETHBTC")
  onChange?: (symbol: string) => void;  // notify parent/panel
  restrictTo?: string[];                // optional subset of bases/quotes
};

export default function PairPicker({ value, onChange, restrictTo }: Props) {
  const [pairs, setPairs] = useState<Tradable[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/pairs", { cache: "no-store" });
        const data = await res.json();
        let list: Tradable[] = data?.pairs ?? [];
        if (restrictTo?.length) {
          const allow = new Set(restrictTo.map((x) => x.toUpperCase()));
          list = list.filter((p) => allow.has(p.base.toUpperCase()) && allow.has(p.quote.toUpperCase()));
        }
        if (alive) setPairs(list);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [restrictTo?.join(",")]);

  const grouped = useMemo(() => {
    // group by base for nicer UX: Base -> [ (base, quote, symbol) ]
    const m = new Map<string, Tradable[]>();
    for (const p of pairs) {
      const k = p.base.toUpperCase();
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    for (const [k, arr] of m) {
      arr.sort((a, b) => a.quote.localeCompare(b.quote));
      m.set(k, arr);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [pairs]);

  if (loading) return <div className="text-xs opacity-70">loading pairs…</div>;

  return (
    <div className="flex gap-2 items-center">
      <label className="text-xs opacity-70">Pair</label>
      <select
        className="border rounded-md px-2 py-1 text-sm"
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value)}
      >
        <option value="" disabled>Choose pair…</option>
        {grouped.map(([base, arr]) => (
          <optgroup key={base} label={base}>
            {arr.map((p) => (
              <option key={p.symbol} value={p.symbol}>
                {p.base}-{p.quote} ({p.symbol})
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
