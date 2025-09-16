'use client';

import React, { useMemo } from 'react';

type MatFlags = {
  frozen: boolean[][];
  bridged: boolean[][];
  preview: number[][]; // 1 = A+B in preview; 0 = not direct (UI infers inverse via [j][i])
};

type Kind = 'benchmark' | 'delta' | 'pct24h' | 'id_pct' | 'pct_drv';

// ✔️ footprint back to the earlier “wide pill”
const CELL_W = 'w-20';   // 5rem ≈ 80px (bump if you want even wider)
const CELL_H = 'h-9';    // 2.25rem
const TXT_SZ = 'text-[12px]';

export default function Matrix({
  kind,
  coins,
  values,
  flags,
}: {
  kind: Kind;
  coins: string[];
  values: (number | null)[][] | null;
  flags?: MatFlags;
}) {
  const n = coins.length;

  const content = useMemo(() => {
    const grid = values || Array.from({ length: n }, () => Array(n).fill(null));
    const froz = flags?.frozen  || Array.from({ length: n }, () => Array(n).fill(false));
    const brid = flags?.bridged || Array.from({ length: n }, () => Array(n).fill(false));
    const prev = flags?.preview || Array.from({ length: n }, () => Array(n).fill(0));

    const rows = [];
    for (let i = 0; i < n; i++) {
      const tds = [];

      // row header (same footprint as a cell)
      tds.push(
        <th key={`row-h-${i}`} className="p-0 sticky left-0 z-10 bg-slate-950">
          <div className={`${CELL_H} ${CELL_W} rounded-xl bg-slate-800/60 border border-slate-700/70 flex items-center justify-center ${TXT_SZ} text-slate-200 font-mono`}>
            {coins[i]}
          </div>
        </th>
      );

      for (let j = 0; j < n; j++) {
        if (i === j) {
          tds.push(
            <td key={j} className="p-0">
              <div className={`${CELL_H} ${CELL_W} rounded-xl bg-slate-800/40 border border-slate-700/60 flex items-center justify-center ${TXT_SZ} text-slate-300 font-mono`}>
                {coins[i]}
              </div>
            </td>
          );
          continue;
        }

        const v = grid[i]?.[j] ?? null;
        const frozen = !!(froz[i]?.[j]);
        const isBridged = !!(brid[i]?.[j]);

        // outer ring = preview nature (static)
        const dir = prev[i]?.[j] === 1;
        const inv = !dir && prev[j]?.[i] === 1;
        const outerRing =
          dir ? 'ring-2 ring-emerald-400/80' :
          inv ? 'ring-2 ring-rose-400/80' :
                'ring-2 ring-slate-500/70';

        // full interior fill (absolute) + inner bridged ring
        const fill = colorFill(kind, v, frozen);

        tds.push(
          <td key={j} className="p-0 align-middle">
            <div className={`relative ${CELL_H} ${CELL_W} rounded-xl ${outerRing}`}>
              <div className={`absolute inset-0 rounded-[inherit] border border-slate-700/70 ${fill} ${isBridged ? 'ring-2 ring-slate-400/80' : ''} flex items-center justify-center`}>
                <div className={`${TXT_SZ} text-slate-100 tabular-nums leading-none`}>
                  {fmt(kind, v)}
                </div>
              </div>
            </div>
          </td>
        );
      }
      rows.push(<tr key={i}>{tds}</tr>);
    }
    return rows;
  }, [coins, values, flags, n, kind]);

  return (
    <div className="overflow-visible">
      {/* collapse table gutters so the absolute fill truly covers 100% */}
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="p-0 sticky left-0 z-10 bg-slate-950" />
            {coins.map((c, j) => (
              <th key={`col-h-${j}`} className="p-0">
                <div className={`${CELL_H} ${CELL_W} rounded-xl bg-slate-800/60 border border-slate-700/70 flex items-center justify-center ${TXT_SZ} text-slate-200 font-mono`}>
                  {c}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{content}</tbody>
      </table>
    </div>
  );
}

/* ---------- helpers ---------- */

function fmt(kind: Kind, n: number | null) {
  if (n === null || Number.isNaN(n)) return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (kind === 'benchmark') {
    const abs = Math.abs(v);
    if (abs >= 1000) return v.toFixed(0);
    if (abs >= 100)  return v.toFixed(1);
    if (abs >= 10)   return v.toFixed(2);
    if (abs >= 1)    return v.toFixed(3);
    return v.toFixed(4);
  }
  const abs = Math.abs(v);
  if (abs >= 1) return v.toFixed(3);
  if (abs >= 0.1) return v.toFixed(4);
  if (abs >= 0.01) return v.toFixed(5);
  return v.toFixed(6);
}

function colorFill(kind: Kind, v: number | null, frozen: boolean): string {
  if (frozen) return 'bg-violet-500/22';
  if (v === null || !Number.isFinite(v)) return 'bg-slate-900';
  const delta = kind === 'benchmark' ? (v - 1) : v;

  // amber if |x| < 1e-8 (neutral)
  if (Math.abs(delta) < 1e-8) return 'bg-amber-400/22';

  // shade bands by magnitude
  const m = Math.abs(delta);
  const band =
    m > 5e-2 ? 3 :
    m > 1e-2 ? 2 :
    m > 1e-3 ? 1 : 0;

  if (delta > 0) {
    return [
      'bg-emerald-500/14',
      'bg-emerald-500/20',
      'bg-emerald-500/28',
      'bg-emerald-500/36',
    ][band];
  } else {
    return [
      'bg-rose-500/14',
      'bg-rose-500/20',
      'bg-rose-500/28',
      'bg-rose-500/36',
    ][band];
  }
}
