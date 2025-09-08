// src/lib/types/aux.ts
export type ReportLevel = 'ok' | 'warn' | 'err';

export interface ReportItem {
  key: string;
  label?: string;
  level: ReportLevel;
  value?: number | string | boolean | null;
  message?: string;
  meta?: Record<string, unknown>;
  ts: number;
}

export interface Report {
  id: string;
  scope: 'system' | 'aux' | 'market' | string;
  items: ReportItem[];
  summary?: {
    level: ReportLevel;
    counts: { ok: number; warn: number; err: number; total: number };
  };
  ts: number;
}

export function summarizeReport(items: ReportItem[]): Report['summary'] {
  let ok = 0, warn = 0, err = 0;
  for (const it of items) {
    if (it.level === 'ok') ok++;
    else if (it.level === 'warn') warn++;
    else err++;
  }
  const total = items.length;
  const level: ReportLevel = err ? 'err' : warn ? 'warn' : 'ok';
  return { level, counts: { ok, warn, err, total } };
}
