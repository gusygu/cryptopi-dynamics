// vectors.ts
// Tendency vectors computed from refs or a matrix projection.
// You can extend scoring/decay functions as needed.

import type { Matrix, Ref } from "@/core/math/ref";

export type Vector = {
  key: string;            // tag, domain, or composite key
  magnitude: number;      // overall strength
  components: Record<string, number>; // breakdown per counterpart (e.g., per-domain for a tag)
};

export type VectorSet = {
  byTag: Vector[];
  byDomain: Vector[];
  updatedAt: string;
};

// Basic aggregation: sums scores (or weights) along each axis
export function vectorsFromMatrix(matrix: Matrix): VectorSet {
  const tagAgg: Record<string, number> = {};
  const tagComp: Record<string, Record<string, number>> = {};
  const domAgg: Record<string, number> = {};
  const domComp: Record<string, Record<string, number>> = {};

  for (const key of Object.keys(matrix.cells)) {
    const cell = matrix.cells[key];
    // tag
    tagAgg[cell.colKey] = (tagAgg[cell.colKey] ?? 0) + cell.score;
    tagComp[cell.colKey] = tagComp[cell.colKey] ?? {};
    tagComp[cell.colKey][cell.rowKey] = (tagComp[cell.colKey][cell.rowKey] ?? 0) + cell.score;
    // domain
    domAgg[cell.rowKey] = (domAgg[cell.rowKey] ?? 0) + cell.score;
    domComp[cell.rowKey] = domComp[cell.rowKey] ?? {};
    domComp[cell.rowKey][cell.colKey] = (domComp[cell.rowKey][cell.colKey] ?? 0) + cell.score;
  }

  const byTag: Vector[] = Object.entries(tagAgg)
    .map(([k, v]) => ({ key: k, magnitude: v, components: tagComp[k] }))
    .sort((a, b) => b.magnitude - a.magnitude);

  const byDomain: Vector[] = Object.entries(domAgg)
    .map(([k, v]) => ({ key: k, magnitude: v, components: domComp[k] }))
    .sort((a, b) => b.magnitude - a.magnitude);

  return { byTag, byDomain, updatedAt: new Date().toISOString() };
}

// Optional: build vectors straight from refs (without matrix), if you prefer
export function vectorsFromRefs(refs: Ref[]): VectorSet {
  const matrixLike: Matrix = {
    rows: [],
    cols: [],
    cells: {}
  };
  // project refs into cells with score=weight or 1
  for (const r of refs) {
    const rowKey = r.domain ?? "unspecified";
    const tags = r.tags && r.tags.length ? r.tags : ["untagged"];
    for (const t of tags) {
      const k = `${rowKey}::${t}`;
      if (!matrixLike.cells[k]) {
        matrixLike.cells[k] = { rowKey, colKey: t, refs: [], score: 0 };
      }
      matrixLike.cells[k].refs.push(r.id);
      matrixLike.cells[k].score += r.weight ?? 1;
    }
  }
  return vectorsFromMatrix(matrixLike);
}

// Merge vectors into "bins" (whatever your domain bins are)
export type Bin = {
  id: string;
  title: string;
  score?: number;
  meta?: Record<string, unknown>;
};

export function integrateVectorsIntoBins(
  bins: Bin[],
  vectors: VectorSet,
  { axis = "byTag" as keyof VectorSet } = {}
): Bin[] {
  const lookup = new Map<string, number>();
  for (const v of vectors[axis] as Vector[]) {
    lookup.set(v.key, v.magnitude);
  }
  return bins.map(b => {
    const score = lookup.get(b.id) ?? lookup.get(b.title) ?? b.score ?? 0;
    return { ...b, score };
  }).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
