// src/core/types.ts
export type MatrixType = 'benchmark'|'delta'|'pct24h'|'id_pct'|'pct_drv';

export type MatricesPayload = {
  ok: boolean;
  coins: string[];
  ts: Record<MatrixType, number|null>;
  prevTs?: Record<MatrixType, number|null>;
  matrices: Record<MatrixType, (number|null)[][] | null>;
  flags: Record<MatrixType, { frozen: boolean[][] } | null>;
};
