// src/core/maths/bridge.ts
import type { TKey } from "@/app/api/matrices/latest/route";

// stable key for maps
export function mkey(a: string, b: string): string {
  return `${String(a).toUpperCase()}|${String(b).toUpperCase()}`;
}

type Via = "direct" | "inverse" | "bridge" | "none";

/**
 * Resolve a matrix value for pair A/B from a map of direct legs.
 * Strategy:
 *  1) direct A|B
 *  2) inverse/antisymmetric from B|A:
 *      - benchmark: v = 1 / (B|A)
 *      - percent-like (delta, pct24h, id_pct, pct_drv): v = -(B|A)
 *  3) USDT bridge:
 *      - benchmark: v = (A|USDT) / (B|USDT)
 *      - percent-like: v = (A|USDT) - (B|USDT)
 *
 * Returns value + whether bridging was used (for inner grey ring) and the 'via' used.
 */
export function resolveValue(
  mp: Map<string, number>,
  A: string,
  B: string,
  kind: TKey
): { value: number | null; via: Via; bridged: boolean } {
  const a = String(A).toUpperCase();
  const b = String(B).toUpperCase();
  if (a === b) return { value: null, via: "none", bridged: false };

  const dir = mp.get(mkey(a, b));
  if (isFiniteN(dir)) return { value: dir, via: "direct", bridged: false };

  const inv = mp.get(mkey(b, a));
  if (isFiniteN(inv)) {
    if (kind === "benchmark") {
      const v = inv === 0 ? null : 1 / inv;
      return { value: isFiniteN(v) ? v! : null, via: "inverse", bridged: false };
    } else {
      // antisymmetric
      const v = -inv;
      return { value: isFiniteN(v) ? v! : null, via: "inverse", bridged: false };
    }
  }

  // USDT bridge
  const aU = mp.get(mkey(a, "USDT"));
  const bU = mp.get(mkey(b, "USDT"));
  if (isFiniteN(aU) && isFiniteN(bU)) {
    if (kind === "benchmark") {
      const v = bU === 0 ? null : aU / bU;
      return { value: isFiniteN(v) ? v! : null, via: "bridge", bridged: true };
    } else {
      const v = aU - bU;
      return { value: isFiniteN(v) ? v! : null, via: "bridge", bridged: true };
    }
  }

  return { value: null, via: "none", bridged: false };
}

function isFiniteN(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}
