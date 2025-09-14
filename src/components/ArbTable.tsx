"use client";

import { useEffect, useMemo, useState } from "react";
import type { ArbRow } from "@/lib/arb";
import { familiesFromRows, filterRows, fmt5, swapPill } from "@/lib/arb";

export default function ArbTable({
  rows,
  defaultFamily = "all",
  title = "Arbitrage Paths",
  className = "",
}: {
  rows: ArbRow[];
  defaultFamily?: string;
  title?: string;
  className?: string;
}) {
  const STORAGE_KEY = "cryptopi:arb:family";

  const [family, setFamily] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_KEY) || defaultFamily; } catch { return defaultFamily; }
  });

  // cross-tab sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && typeof e.newValue === "string") setFamily(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, family); } catch {}
  }, [family]);

  const families = useMemo(() => {
    const f = familiesFromRows(rows);
    return f.includes("all") ? f : ["all", ...f];
  }, [rows]);

  const visible = useMemo(() => filterRows(rows, family), [rows, family]);

  // re-render swap timers once per second (lightweight)
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick(x => (x + 1) & 0xff), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className={`rounded-xl border border-slate-600/40 bg-slate-800/40 p-3 ${className}`}>
      <div className="mb-3 flex items-center gap-3">
        <div className="text-sm text-slate-200">{title}</div>
        <div className="ml-auto flex items-center gap-2">
          {families.length > 1 && (
            <>
              <span className="text-xs text-slate-400">Family</span>
              <select
                value={family}
                onChange={(e) => setFamily(e.target.value)}
                className="text-xs bg-slate-900/70 border border-slate-600/40 rounded-md px-2 py-1"
                title="Select path family"
              >
                {families.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>

      <div className="overflow-auto">
        <table className="min-w-full text-[12px]">
          <thead>
            <tr className="text-slate-400">
              <th className="text-left py-1 px-2">Path</th>
              <th className="text-right py-1 px-2">id_pct</th>
              <th className="text-right py-1 px-2">drv%</th>
              <th className="text-left py-1 px-2">extra</th>
              <th className="text-right py-1 px-2">swap</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const pill = swapPill(r.swapTag, r.swapTs);
              return (
                <tr key={r.id} className="border-t border-slate-700/30">
                  <td className="py-1 px-2">{r.pathLabel}</td>
                  <td className="text-right px-2 font-mono">{fmt5(r.id_pct)}</td>
                  <td className="text-right px-2 font-mono">{fmt5(r.drv_pct)}</td>
                  <td className="px-2">{r.extra ?? "—"}</td>
                  <td className="text-right px-2">
                    <span className={pill.cls}>{pill.label}</span>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-center text-slate-500">—</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
