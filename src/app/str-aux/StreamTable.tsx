'use client';
import React from 'react';

function pretty(n: number | undefined | null, digits = 6) {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  const v = Number(n);
  return Math.abs(v) >= 1e-6 ? v.toFixed(digits) : v.toExponential(2);
}

export default function StreamsTable({
  streams,
}: {
  streams?: {
    benchmark?: { prev: number; cur: number; greatest: number }; // now PRICE
    pct24h?:    { prev: number; cur: number; greatest: number }; // %
    pct_drv?:   { prev: number; cur: number; greatest: number }; // %
  };
}) {
  const rows: Array<[string, { prev?: number; cur?: number; greatest?: number }, '%' | '' ]> = [
    ['benchmark', streams?.benchmark ?? {}, ''],   // 👈 price, no unit
    ['pct24h',    streams?.pct24h    ?? {}, '%'],
    ['pct_drv',   streams?.pct_drv   ?? {}, '%'],
  ];

  return (
    <div className="rounded-xl bg-[var(--panel-2)] border border-[var(--border)] overflow-hidden">
      <div className="px-3 py-2 text-xs text-[var(--muted)] border-b border-[var(--border)]">Streams</div>
      <table className="w-full text-sm">
        <thead className="text-xs text-[var(--muted)]">
          <tr>
            <th className="text-left px-3 py-2">metric</th>
            <th className="text-right px-3 py-2">prev</th>
            <th className="text-right px-3 py-2">cur</th>
            <th className="text-right px-3 py-2">greatest</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, v, unit]) => (
            <tr key={label} className="border-t border-[var(--border)]">
              <td className="px-3 py-2 text-[var(--text)]">{label}</td>
              <td className="px-3 py-2 text-right tabular-nums">{pretty(v.prev, 6)}{unit}</td>
              <td className="px-3 py-2 text-right tabular-nums">{pretty(v.cur, 6)}{unit}</td>
              <td className="px-3 py-2 text-right tabular-nums">{pretty(v.greatest, 6)}{unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
