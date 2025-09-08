"use client";

import React, { useMemo } from "react";
import { useMeaAux } from "../hooks/useMeaAux";

/** ---------- helpers ---------- */

const fmt = (x: number | null | undefined) =>
  x == null || !Number.isFinite(Number(x))
    ? "—"
    : Number(x).toLocaleString(undefined, { maximumFractionDigits: 6 });

/** tier → color (one color per rank, not pos/neg) */
const tierClass = (t: number) => {
  switch (t) {
    case 1: return "bg-emerald-900/40 border-emerald-700/40 text-emerald-200";
    case 2: return "bg-sky-900/40     border-sky-700/40     text-sky-200";
    case 3: return "bg-amber-900/40   border-amber-700/40   text-amber-200";
    case 4: return "bg-violet-900/40  border-violet-700/40  text-violet-200";
    default:return "bg-rose-900/40    border-rose-700/40    text-rose-200";
  }
};

/** try to read value+tier from multiple possible MEA shapes */
function buildMaps(data: any, coins: string[]) {
  // Accept shapes:
  //  A) data.pairs: [{base,quote,value,tier_id?}] (preferred)
  //  B) data.grid or data.values: { [base]: { [quote]: number } }
  //  C) data.matrix: number[][] aligned to coins order
  const val = new Map<string, number>();
  const tier = new Map<string, number>();

  const set = (b: string, q: string, v: any, t?: any) => {
    const k = `${b}|${q}`;
    if (v != null && Number.isFinite(Number(v))) val.set(k, Number(v));
    if (t != null && Number.isFinite(Number(t))) tier.set(k, Math.max(1, Math.min(5, Number(t))));
  };

  if (Array.isArray(data?.pairs)) {
    for (const p of data.pairs) set(String(p.base).toUpperCase(), String(p.quote).toUpperCase(), p.value, p.tier_id ?? p.tier ?? p.rank);
  }

  const obj = data?.grid ?? data?.values;
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [b, row] of Object.entries(obj as Record<string, any>)) {
      for (const [q, v] of Object.entries(row as Record<string, any>)) {
        set(String(b).toUpperCase(), String(q).toUpperCase(), v, (row as any)?.__tier?.[q]);
      }
    }
  }

  if (Array.isArray(data?.matrix)) {
    const m: any[][] = data.matrix;
    for (let i = 0; i < coins.length; i++) {
      for (let j = 0; j < coins.length; j++) {
        const v = m?.[i]?.[j];
        set(coins[i], coins[j], v);
      }
    }
  }

  // If no explicit tier, derive 1..5 row-wise by quantiles for a stable palette.
  if (tier.size === 0 && val.size) {
    for (const b of coins) {
      const rowVals: number[] = [];
      for (const q of coins) {
        const k = `${b}|${q}`;
        const v = val.get(k);
        if (v != null) rowVals.push(v);
      }
      rowVals.sort((a, b) => a - b);
      const q = (p: number) => rowVals[Math.min(rowVals.length - 1, Math.max(0, Math.floor(p * (rowVals.length - 1))))];
      const q1 = q(0.2), q2 = q(0.4), q3 = q(0.6), q4 = q(0.8);
      for (const qSym of coins) {
        const k = `${b}|${qSym}`;
        const v = val.get(k);
        const t =
          v == null ? 3 :
          v <= q1 ? 1 :
          v <= q2 ? 2 :
          v <= q3 ? 3 :
          v <= q4 ? 4 : 5;
        tier.set(k, t);
      }
    }
  }

  return { val, tier };
}

/** ---------- component ---------- */
type Props = {
  initialCoins?: string[];
  defaultK?: number;
  autoRefreshMs?: number; // UI timer; hook still gates at ~40s per key
};

export default function MeaAuxTable({
  initialCoins = ["BTC", "ETH", "BNB", "SOL", "ADA", "XRP", "PEPE", "USDT"],
  defaultK = 7,
  autoRefreshMs = 40000,
}: Props) {
  const { data, coins = initialCoins, setCoins, k = defaultK, setK, loading, error } = useMeaAux({
    coins: initialCoins,
    k: defaultK,
    refreshMs: autoRefreshMs,
  });

  const coinsU = useMemo(() => coins.map((c: string) => c.toUpperCase()), [coins]);

  const { val, tier } = useMemo(() => buildMaps(data, coinsU), [data, coinsU]);

  const ttlS = Math.round((autoRefreshMs ?? 40000) / 1000);

  return (
    <div className="rounded-2xl bg-slate-900/60 p-3 text-[12px] text-slate-200 border border-slate-700/30">
      {/* Header / controls */}
      <div className="mb-2 flex items-center gap-2">
        <div className="text-slate-300 font-semibold">mea-aux</div>
        <div className="ml-auto flex items-center gap-2">
          <input
            className="px-2 py-1 rounded-md bg-slate-800 border border-slate-700/50 w-[300px]"
            defaultValue={coinsU.join(",")}
            onBlur={(e) => {
              const v = e.currentTarget.value.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
              if (v.length) setCoins(v);
            }}
          />
          <label className="text-slate-400">k</label>
          <input
            type="number"
            className="w-16 px-2 py-1 rounded-md bg-slate-800 border border-slate-700/50"
            defaultValue={k}
            onBlur={(e) => setK(Math.max(1, Number(e.currentTarget.value) || defaultK))}
          />
          <span className="text-slate-500">auto-refresh {ttlS}s</span>
        </div>
      </div>

      {error && (
        <div className="text-rose-300 text-xs mb-2">
          mea_aux error: {String(error.message || error)}
        </div>
      )}

      {/* Matrix-like table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800/60 bg-slate-900">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-800/60 text-slate-300">
            <tr>
              <th className="px-2 py-2 text-left text-slate-400">BASE \\ QUOTE</th>
              {coinsU.map((q) => (
                <th key={`h-${q}`} className="px-2 py-2 text-right text-slate-300">{q}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {coinsU.map((b) => (
              <tr key={`r-${b}`}>
                <td className="px-2 py-2 text-slate-300 font-semibold">{b}</td>
                {coinsU.map((q) => {
                  const k = `${b}|${q}`;
                  const v = val.get(k);
                  const t = tier.get(k) ?? 3;
                  const isDiag = b === q;
                  return (
                    <td key={`c-${k}`} className="px-1 py-1">
                      <div
                        className={[
                          "w-full rounded-md border px-2 py-1",
                          "font-mono tabular-nums tracking-tight text-right",
                          isDiag
                            ? "bg-slate-900 border-slate-800 text-slate-500"
                            : `${tierClass(t)}`
                        ].join(" ")}
                        title={`${b}/${q} • tier ${t}`}
                      >
                        {isDiag ? "—" : fmt(v)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}

            {!coinsU.length && (
              <tr><td colSpan={coinsU.length + 1} className="px-3 py-4 text-slate-500">no coins</td></tr>
            )}
            {!loading && val.size === 0 && (
              <tr><td colSpan={coinsU.length + 1} className="px-3 py-4 text-slate-500">no MEA values yet</td></tr>
            )}
            {loading && (
              <tr><td colSpan={coinsU.length + 1} className="px-3 py-4 text-slate-400">loading…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-2 text-[11px] text-slate-500">
        Values are BASE-centered; tier coloring uses per-row quantiles when explicit tier ids are not provided.
      </div>
    </div>
  );
}
