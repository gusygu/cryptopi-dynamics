// src/math/utils.ts
// src/core/math/utils.ts  (or wherever your utils live; you sent "utils.ts")
export function uniqUpper(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of list) {
    const u = String(t || "").trim().toUpperCase();
    if (!u) continue;
    if (!seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out;
}

export function newGrid<T>(n: number, fill: T): T[][] {
  return Array.from({ length: n }, () => Array(n).fill(fill));
}

export function invertGrid(M: (number | null)[][]): (number | null)[][] {
  const n = M.length;
  const out = newGrid<number | null>(n, null);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const v = M[i]?.[j] ?? null;
      out[j][i] = (v != null && v !== 0) ? (1 / v) : null;
    }
  }
  return out;
}

export function antisymmetrize(M: (number | null)[][]): (number | null)[][] {
  const n = M.length;
  const out = newGrid<number | null>(n, null);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const a = M[i]?.[j];
      const b = M[j]?.[i];
      if (a != null && Number.isFinite(a)) out[i][j] = a;
      else if (b != null && Number.isFinite(b)) out[i][j] = -b;
      else out[i][j] = null;
    }
  }
  return out;
}
