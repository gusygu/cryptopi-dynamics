// src/auxiliary/mea_aux/ui/MeaAuxCard.tsx
"use client";

import React, { useEffect, useMemo } from "react";
import { useMeaAux } from "../hooks/useMeaAux";

/* ---------- small utils ---------- */

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

function buildMaps(data: any, coins: string[]) {
  // Accept:
  //  A) data.pairs: [{base,quote,value,tier_id?,frozen?}]  <-- preferred, includes frozen
  //  B) data.grid / data.values: { [base]: { [quote]: number } }
  //  C) data.matrix: number[][] aligned to coins order
  const val = new Map<string, number>();
  const tier = new Map<string, number>();
  const froz = new Set<string>();

  const put = (b: string, q: string, v: any, t?: any, f?: boolean) => {
    const k = `${b}|${q}`;
    if (v != null && Number.isFinite(Number(v))) val.set(k, Number(v));
    if (t != null && Number.isFinite(Number(t))) tier.set(k, Math.max(1, Math.min(5, Number(t))));
    if (f === true) froz.add(k);
  };

  if (Array.isArray(data?.pairs)) {
    for (const p of data.pairs) {
      const B = String(p.base).toUpperCase(), Q = String(p.quote).toUpperCase();
      put(B, Q, p.value, p.tier_id ?? p.tier ?? p.rank, p.frozen === true);
    }
  }

  const obj = data?.grid ?? data?.values;
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [b, row] of Object.entries(obj as Record<string, any>)) {
      for (const [q, v] of Object.entries(row as Record<string, any>)) {
        put(String(b).toUpperCase(), String(q).toUpperCase(), v, (row as any)?.__tier?.[q], (row as any)?.__frozen?.[q]);
      }
    }
  }

  if (Array.isArray(data?.matrix)) {
    const m: any[][] = data.matrix;
    for (let i = 0; i < coins.length; i++) {
      for (let j = 0; j < coins.length; j++) {
        const v = m?.[i]?.[j];
        put(coins[i], coins[j], v);
      }
    }
  }

  // If still no explicit tiers, derive 1..5 row-wise by quantiles
  if (tier.size === 0 && val.size) {
    for (const b of coins) {
      const rowVals: number[] = [];
      for (const q of coins) {
        const v = val.get(`${b}|${q}`);
        if (v != null) rowVals.push(v);
      }
      rowVals.sort((a, b) => a - b);
      if (!rowVals.length) continue;
      const qf = (p: number) =>
        rowVals[Math.min(rowVals.length - 1, Math.max(0, Math.floor(p * (rowVals.length - 1))))];
      const q1 = qf(0.2), q2 = qf(0.4), q3 = qf(0.6), q4 = qf(0.8);
      for (const q of coins) {
        const v = val.get(`${b}|${q}`);
        const t =
          v == null ? 3 :
          v <= q1 ? 1 :
          v <= q2 ? 2 :
          v <= q3 ? 3 :
          v <= q4 ? 4 : 5;
        tier.set(`${b}|${q}`, t);
      }
    }
  }

  return { val, tier, froz };
}

/* ---------- component ---------- */

type Props = {
  coins?: string[];        // optional fixed set; defaults to common list
  defaultK?: number;       // initial k
  autoRefreshMs?: number;  // UI cadence; hook still gates ~40s internally
};

export default function MeaAuxCard({
  coins = ["BTC","ETH","BNB","SOL","ADA","XRP","PEPE","USDT"],
  defaultK = 7,
  autoRefreshMs = 40000,
}: Props) {
  // Reuse your table's functional logic (auto-start interval, refresh on k change)
  const aux = useMeaAux({
    coins,
    k: defaultK,
    refreshMs: autoRefreshMs,
  }) as any;

  const { data, loading, error } = aux;
  const k = aux?.k ?? defaultK;
  const setK: (v: number) => void = aux?.setK ?? (() => {});
  const refresh: () => void = aux?.refresh ?? (() => {});
  const start: () => void = aux?.start ?? (() => {});
  const stop: () => void = aux?.stop ?? (() => {});

  useEffect(() => {
    start();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const coinsU = useMemo(() => coins.map((c) => c.toUpperCase()), [coins]);
  const { val, tier, froz } = useMemo(() => buildMaps(data, coinsU), [data, coinsU]);

  const errText = error ? String((error as any)?.message ?? error) : aux?.err ?? "";

  const ttlS = Math.round((autoRefreshMs ?? 40000) / 1000);

  return (
    <div className="rounded-2xl bg-slate-900/60 p-3 text-[12px] text-slate-200 border border-slate-700/30">
      {/* header: title + small k field (no coins box, no auto-refresh) */}
      <div className="mb-2 flex items-center gap-2">
        <div className="text-slate-300 font-semibold">med-aux</div>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-slate-400">k</label>
          <input
            type="number"
            min={1}
            step={1}
            className="w-16 px-2 py-1 rounded-md bg-slate-800 border border-slate-700/50 text-slate-200"
            defaultValue={k}
            onBlur={(e) => {
              const v = Math.max(1, Math.floor(Number(e.currentTarget.value) || defaultK));
              setK(v);
              refresh(); // re-evaluate with new k
            }}
          />
          <span className="text-slate-500 text-xs">refresh {ttlS}s</span>
        </div>
      </div>

      {errText && <div className="text-rose-300 text-xs mb-2">mea_aux error: {errText}</div>}

      {/* matrix-like table, pct_drv look */}
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
                  const key = `${b}|${q}`;
                  const diag = b === q;
                  const frozen = !diag && froz.has(key);
                  const v = val.get(key);
                  const t = tier.get(key) ?? 3;
                  return (
                    <td key={`c-${key}`} className="px-1 py-1">
                      <div
                        className={[
                          "w-full rounded-md border px-2 py-1",
                          "font-mono tabular-nums tracking-tight text-right",
                          diag
                            ? "bg-slate-900 border-slate-800 text-slate-500"
                            : frozen
                              ? "bg-amber-900/60 border-amber-600/50 text-amber-200"
                              : tierClass(t),
                        ].join(" ")}
                        title={`${b}/${q}${frozen ? " • FROZEN" : ` • tier ${t}`}`}
                      >
                        {diag ? "—" : frozen ? "0" : fmt(v)}
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
    </div>
  );
}
