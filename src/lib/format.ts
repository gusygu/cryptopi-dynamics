// src/lib/format.ts
export type HeatKind = 'pct' | 'abs';

export const fmt7 = (x: number | null | undefined) =>
  x == null || !Number.isFinite(x)
    ? '—'
    : (Math.abs(x) < 1e-12 ? 0 : x).toFixed(7);

export function formatForDisplay(value: number | null | undefined, kind: HeatKind) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (kind === 'pct') {
    // ONLY pct24h uses percentage display
    const pct = value * 100;
    return `${(Math.abs(pct) < 1e-9 ? 0 : pct).toFixed(2)}%`;
  }
  // Everything else (benchmark, delta, id_pct, pct_drv) = raw number with 7 decimals
  return fmt7(value);
}

export function heat(
  value: number | null | undefined,
  opts: { kind: HeatKind; frozen?: boolean }
) {
  if (opts.frozen) return { background: 'rgba(128, 0, 128, 0.25)' }; // purple
  if (value == null || !Number.isFinite(value)) return { background: 'transparent' };

  // yellow band near zero
  const v = value;
  const nearZero = opts.kind === 'pct' ? 1e-6 : 1e-9;
  if (Math.abs(v) < nearZero) return { background: 'rgba(255, 255, 0, 0.25)' };

  // basic green/red intensity
  const denom = opts.kind === 'pct' ? 0.05 : 0.02; // tune if needed
  const mag = Math.min(1, Math.abs(v) / denom);
  const g = v > 0 ? Math.round(255 * mag) : 0;
  const r = v < 0 ? Math.round(255 * mag) : 0;
  return { background: `rgba(${r},${g},0,0.25)` };
}

export const tsLabel = (ts: number | null | undefined) => {
  if (!ts || !Number.isFinite(ts)) return '—';
  const d = new Date(Number(ts));
  return isNaN(d.getTime()) ? '—' : d.toLocaleString();
};
