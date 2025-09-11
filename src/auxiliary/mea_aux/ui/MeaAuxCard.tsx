// src/auxiliary/mea_aux/ui/MeaAuxCard.tsx
"use client";

import React, { useEffect, useMemo } from "react";
import { useMeaAux } from "../hooks/useMeaAux";

/* ---------- helpers ---------- */

// fixed 6-decimal output
const fmt = (x: number | null | undefined) =>
  x == null || !Number.isFinite(Number(x)) ? "—" : Number(x).toFixed(6);

// precedence: frozen (amber) > null (grey) > yellow (===0) > green/red by sign
function cellClassByValue(v: number | null | undefined, frozen?: boolean) {
  if (frozen) return "bg-amber-900/60 border-amber-600/50 text-amber-200";
  if (v == null) return "bg-slate-900 border-slate-800 text-slate-500";
  if (v === 0) return "bg-amber-900/30 border-amber-700/40 text-amber-200";

  const n = Number(v);
  const m = Math.abs(n);

  const pos = [
    "bg-emerald-900/20 text-emerald-200 border-emerald-800/25",
    "bg-emerald-900/35 text-emerald-200 border-emerald-800/40",
    "bg-emerald-900/55 text-emerald-100 border-emerald-800/60",
    "bg-emerald-900/75 text-emerald-100 border-emerald-800/80",
  ];
  const neg = [
    "bg-red-950/30 text-red-200 border-red-900/40",
    "bg-red-900/45 text-red-200 border-red-800/55",
    "bg-red-900/65 text-red-100 border-red-800/75",
    "bg-red-900/85 text-red-100 border-red-800/90",
  ];

  const idx = m < 0.0005 ? 0 : m < 0.002 ? 1 : m < 0.01 ? 2 : 3;
  return n > 0 ? pos[idx] : neg[idx];
}

/** Accept pairs/grid/matrix shapes; collect values and frozen flags */
function buildMaps(data: any, coins: string[]) {
  const val = new Map<string, number>();
  const froz = new Set<string>();

  const put = (b: string, q: string, v: any, f?: boolean) => {
    const k = `${b}|${q}`;
    if (v != null && Number.isFinite(Number(v))) val.set(k, Number(v));
    if (f === true) froz.add(k);
  };

  // A) preferred: pairs (includes frozen)
  if (Array.isArray(data?.pairs)) {
    for (const p of data.pairs) {
      const B = String(p.base).toUpperCase();
      const Q = String(p.quote).toUpperCase();
      put(B, Q, p.value, p.frozen === true);
    }
  }

  // B) grid/values object
  const obj = data?.grid ?? data?.values;
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [b, row] of Object.entries(obj as Record<string, any>)) {
      for (const [q, v] of Object.entries(row as Record<string, any>)) {
        put(String(b).toUpperCase(), String(q).toUpperCase(), v, (row as any)?.__frozen?.[q]);
      }
    }
  }

  // C) matrix aligned to coins order
  if (Array.isArray(data?.matrix)) {
    const m: any[][] = data.matrix;
    for (let i = 0; i < coins.length; i++) {
      for (let j = 0; j < coins.length; j++) {
        const v = m?.[i]?.[j];
        put(coins[i], coins[j], v);
      }
    }
  }

  return { val, froz };
}

/* ---------- component ---------- */

type Props = {
  /** Coin list to render (and fetch through the hook) */
  coins?: string[];
  /** Initial k value passed to the MEA builder */
  defaultK?: number;
  /** UI refresh cadence; API layer is still cache/rate-limited internally */
  autoRefreshMs?: number;
};

export default function MeaAuxCard({
  coins = ["BTC","ETH","BNB","SOL","ADA","XRP","PEPE","USDT"],
  defaultK = 7,
  autoRefreshMs = 40000,
}: Props) {
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
  const { val, froz } = useMemo(() => buildMaps(data, coinsU), [data, coinsU]);

  const errText = error ? String((error as any)?.message ?? error) : aux?.err ?? "";
  const ttlS = Math.round((autoRefreshMs ?? 40000) / 1000);

  return (
    <div className="rounded-2xl bg-slate-900/60 p-3 text-[12px] text-slate-200 border border-slate-700/30">
      {/* header */}
      <div className="mb-2 flex items-center gap-2">
        <div className="text-slate-300 font-semibold">mea-aux</div>
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

      {/* Full antisymmetric matrix */}
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
            {coinsU.map((b, i) => (
              <tr key={`r-${b}`}>
                <td className="px-2 py-2 text-slate-300 font-semibold">{b}</td>
                {coinsU.map((q, j) => {
                  const key = `${b}|${q}`;
                  const diag = b === q;
                  const frozen = !diag && froz.has(key);
                  const v = val.get(key);

                  return (
                    <td key={`c-${key}`} className="px-1 py-1">
                      <div
                        className={[
                          "w-full rounded-md border px-2 py-1",
                          "font-mono tabular-nums tracking-tight text-right",
                          diag
                            ? "bg-slate-900 border-slate-800 text-slate-500"
                            : cellClassByValue(v, frozen),
                        ].join(" ")}
                        title={`${b}/${q}${frozen ? " • FROZEN" : ""}`}
                      >
                        {diag ? "—" : fmt(v)}
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
