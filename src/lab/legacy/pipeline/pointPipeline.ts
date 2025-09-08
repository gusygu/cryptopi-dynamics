export type RawPoint = { ts: number; price: number; volume?: number };
export type Point = { ts: number; price: number; volume: number };

export type PointPipelineOpts = {
  clampVolumeMin?: number;   // default 0
  maxPoints?: number;        // default 600
  sortByTs?: "asc" | "desc"; // default "asc"
  dedupe?: boolean;          // drop identical consecutive ts/price
};

export function createPointPipeline(raw: RawPoint[], opts: PointPipelineOpts = {}): Point[] {
  const {
    clampVolumeMin = 0,
    maxPoints = 600,
    sortByTs = "asc",
    dedupe = true,
  } = opts;

  let list = raw.map(p => ({
    ts: Math.trunc(p.ts),
    price: Number(p.price),
    volume: Math.max(clampVolumeMin, Number(p.volume ?? 0)),
  })).filter(p => Number.isFinite(p.ts) && Number.isFinite(p.price));

  list.sort((a, b) => sortByTs === "asc" ? a.ts - b.ts : b.ts - a.ts);

  if (dedupe && list.length) {
    const out: Point[] = [];
    let prev: Point | null = null;
    for (const p of list) {
      if (!prev || p.ts !== prev.ts || p.price !== prev.price) out.push(p);
      prev = p;
    }
    list = out;
  }

  if (list.length > maxPoints) {
    list = list.slice(-maxPoints);
  }

  return list;
}
