import React, { useMemo } from 'react';

export default function Histogram({
  counts,
  width = 256,
  height = 70,
  className,
  nuclei = [],
}: {
  counts: number[];
  width?: number;
  height?: number;
  className?: string;
  nuclei?: number[]; // bin indices
}) {
  const { path, modeIdx } = useMemo(() => {
    const n = counts.length || 0;
    const max = counts.reduce((a, b) => (b > a ? b : a), 0) || 1;
    const step = n > 1 ? width / (n - 1) : width;
    const pts: string[] = [];
    for (let i = 0; i < n; i++) {
      const x = i * step;
      const y = height - (counts[i] / max) * height;
      pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    let modeIdx = 0;
    let best = -Infinity;
    for (let i = 0; i < counts.length; i++) if (counts[i] > best) { best = counts[i]; modeIdx = i; }
    return { path: pts.join(' '), modeIdx };
  }, [counts, width, height]);

  const step = counts.length > 1 ? width / (counts.length - 1) : width;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} className={className}>
      <path d={`${path} L ${width} ${height} L 0 ${height} Z`} fill="rgb(139 92 246 / 0.12)" />
      <path d={path} stroke="rgb(139 92 246)" strokeWidth={1.5} fill="none" />
      <line
        x1={modeIdx * step}
        x2={modeIdx * step}
        y1={0}
        y2={height}
        stroke="rgb(139 92 246)"
        strokeOpacity={0.35}
        strokeDasharray="2 2"
      />
      {nuclei.map((i, k) => (
        <line
          key={`${i}-${k}`}
          x1={i * step}
          x2={i * step}
          y1={0}
          y2={height}
          stroke="rgb(59 227 129)"
          strokeWidth={2}
          strokeOpacity={0.85}
        />
      ))}
    </svg>
  );
}
