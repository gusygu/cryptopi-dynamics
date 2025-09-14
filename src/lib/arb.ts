// src/lib/arb.ts
export type ArbRow = {
  id: string;                // stable key
  family?: string;           // path family label (e.g., "(2→3)", "(3→1)", "(1→3)")
  pathLabel: string;         // human label like "C1→C2→USDT"
  id_pct?: number;           // identification percent (decimal, e.g., 0.00123)
  drv_pct?: number;          // derivative/vTendency percent (decimal)
  extra?: string;            // free text
  swapTag?: number;          // -1/0/1 or any discrete small int
  swapTs?: number;           // epoch ms of last swap change
};

export type PathFilter = {
  families?: string[];       // available families (unique from data)
  selected?: string;         // currently selected family
};

export function uniq<T>(arr: T[]): T[] {
  const s = new Set(arr);
  return Array.from(s);
}

export function familiesFromRows(rows: ArbRow[]): string[] {
  return uniq(rows.map(r => r.family || "all")).filter(Boolean);
}

// fixed 5 decimals for decimals or percentages-as-decimals
export const fmt5 = (x?: number) =>
  x == null || !Number.isFinite(Number(x)) ? "0.00000" : Number(x).toFixed(5);

// "0 00:00" style pill; neutral if missing
export function swapPill(tag?: number, ts?: number): { label: string; cls: string } {
  // time since (mm:ss); cap to 99:59 for display
  let mm = 0, ss = 0;
  if (Number.isFinite(ts)) {
    const d = Math.max(0, Date.now() - Number(ts));
    mm = Math.floor(d / 60000);
    ss = Math.floor((d % 60000) / 1000);
    if (mm > 99) mm = 99;
  }
  const tLabel = `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;

  const t = Number(tag);
  if (!Number.isFinite(t)) return { label: `0 ${tLabel}`, cls: "bg-slate-700/50 text-slate-300 border-slate-600/40" };

  const base = "border px-2 py-1 rounded-md text-[11px] font-mono";
  if (t > 0) return { label: `+${t} ${tLabel}`, cls: `${base} bg-emerald-600/25 text-emerald-200 border-emerald-500/30` };
  if (t < 0) return { label: `-${Math.abs(t)} ${tLabel}`, cls: `${base} bg-rose-600/25 text-rose-200 border-rose-500/30` };
  return { label: `0 ${tLabel}`, cls: `${base} bg-slate-700/50 text-slate-300 border-slate-600/40` };
}

export function filterRows(rows: ArbRow[], selected?: string): ArbRow[] {
  if (!selected || selected === "all") return rows;
  return rows.filter(r => (r.family || "all") === selected);
}
