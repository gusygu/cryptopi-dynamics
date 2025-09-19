// ref.ts
// Integration glue: types, validation, and DB save/load for "refs"
// Replace the in-memory DB with your adapter (e.g., Prisma) by swapping dbAdapter below.

import { normalize, slug, stableHash } from "@/str-aux";

// ————— Types —————
export type RefId = string;

export type Ref = {
  id: RefId;                 // deterministic, derived from content unless provided
  title: string;
  domain?: string;           // e.g., category or logical group
  tags?: string[];
  weight?: number;           // optional importance
  payload?: Record<string, unknown>; // anything extra you want to carry
  createdAt: string;         // ISO
  updatedAt: string;         // ISO
};

export type NewRefInput = {
  id?: RefId;
  title: string;
  domain?: string;
  tags?: string[];
  weight?: number;
  payload?: Record<string, unknown>;
};

// For matrix projection
export type MatrixCell = {
  rowKey: string;               // e.g., domain
  colKey: string;               // e.g., tag
  refs: RefId[];                // which refs land here
  score: number;                // aggregate weight or count
};

export type Matrix = {
  rows: string[];
  cols: string[];
  cells: Record<string, MatrixCell>; // key = `${rowKey}::${colKey}`
};

// ————— Minimal pluggable DB —————
type DBRecord = Ref;
type DB = {
  upsert: (r: DBRecord) => Promise<DBRecord>;
  getById: (id: RefId) => Promise<DBRecord | null>;
  list: (opts?: { domain?: string }) => Promise<DBRecord[]>;
};

// In-memory fallback so you can run now.
const mem = new Map<RefId, DBRecord>();
const memoryDB: DB = {
  async upsert(r) {
    mem.set(r.id, r);
    return r;
  },
  async getById(id) {
    return mem.get(id) ?? null;
  },
  async list(opts) {
    const all = Array.from(mem.values());
    if (!opts?.domain) return all;
    return all.filter(r => r.domain === opts.domain);
  }
};

// Swap this with your real adapter when ready
const dbAdapter: DB = memoryDB;

// ————— Core helpers —————
export function makeRefId(input: NewRefInput): RefId {
  if (input.id) return input.id;
  // deterministic, avoids dupes on re-posts
  return stableHash(`${normalize(input.title)}|${input.domain ?? ""}|${(input.tags ?? []).sort().join(",")}`);
}

export function nowIso() {
  return new Date().toISOString();
}

export function validateRef(input: NewRefInput): asserts input is NewRefInput {
  if (!input.title || typeof input.title !== "string") {
    throw new Error("Ref.title is required (string).");
  }
  if (input.tags && !Array.isArray(input.tags)) {
    throw new Error("Ref.tags must be an array of strings.");
  }
}

// Upsert + normalize
export async function saveRef(input: NewRefInput): Promise<Ref> {
  validateRef(input);
  const id = makeRefId(input);
  const base: Ref = {
    id,
    title: input.title.trim(),
    domain: input.domain ? slug(input.domain) : undefined,
    tags: input.tags?.map(t => slug(t)) ?? [],
    weight: typeof input.weight === "number" ? input.weight : 1,
    payload: input.payload ?? {},
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  const existing = await dbAdapter.getById(id);
  const next: Ref = existing
    ? { ...existing, ...base, createdAt: existing.createdAt, updatedAt: nowIso() }
    : base;
  return dbAdapter.upsert(next);
}

export async function getRef(id: RefId) {
  return dbAdapter.getById(id);
}

export async function listRefs(opts?: { domain?: string }) {
  return dbAdapter.list(opts);
}

// ————— Matrix projection —————
// Project refs into a domain × tag matrix (row = domain, col = tag).
export async function buildMatrix(opts?: { domain?: string; useWeight?: boolean }): Promise<Matrix> {
  const refs = await listRefs({ domain: opts?.domain });
  const rows = new Set<string>();
  const cols = new Set<string>();
  const cells: Record<string, MatrixCell> = {};

  for (const r of refs) {
    const rowKey = r.domain ?? "unspecified";
    rows.add(rowKey);
    const tagList = r.tags && r.tags.length ? r.tags : ["untagged"];
    for (const tag of tagList) {
      cols.add(tag);
      const key = `${rowKey}::${tag}`;
      if (!cells[key]) {
        cells[key] = { rowKey, colKey: tag, refs: [], score: 0 };
      }
      cells[key].refs.push(r.id);
      cells[key].score += opts?.useWeight ? (r.weight ?? 1) : 1;
    }
  }
  return {
    rows: Array.from(rows).sort(),
    cols: Array.from(cols).sort(),
    cells
  };
}
