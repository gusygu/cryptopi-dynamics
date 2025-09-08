// src/math/utils.ts

export function newGrid<T = number | null>(n: number, fill: T): T[][] {
  return Array.from({ length: n }, () => Array(n).fill(fill));
}

/**
 * For "benchmark": fill inverses as 1/x (leave direct values untouched).
 * Diagonal stays null.
 */
export function invertGrid(src: (number | null)[][]): (number | null)[][] {
  const n = src.length;
  const out = newGrid<number | null>(n, null);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const v = src[i][j];
      if (v != null && Number.isFinite(v)) {
        out[i][j] = v;
        if (src[j][i] == null) out[j][i] = 1 / v;
      }
    }
  }
  return out;
}

/**
 * For antisymmetric metrics ("pct24h", often "delta"): fill missing as -x.
 * Diagonal stays null.
 */
export function antisymmetrize(src: (number | null)[][]): (number | null)[][] {
  const n = src.length;
  const out = newGrid<number | null>(n, null);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const v = src[i][j];
      if (v != null && Number.isFinite(v)) {
        out[i][j] = v;
        if (src[j][i] == null) out[j][i] = -v;
      }
    }
  }
  return out;
}
