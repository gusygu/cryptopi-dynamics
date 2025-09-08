// src/lab/aux-str/circular.ts
import type { Point, WindowKey } from "./types";

/**
 * Circular set sizes per window:
 *  - 30m → 45 points
 *  - 1h  → 90 points
 *  - 3h  → 270 points
 */
export function requiredPointCount(window: WindowKey): number {
  switch (window) {
    case "30m": return 45;
    case "1h": return 90;
    case "3h": return 270;
    default: return 45;
  }
}

export function compactForWindow(points: Point[], window: WindowKey): Point[] {
  const need = requiredPointCount(window);
  if (points.length <= need) return points.slice();
  return points.slice(points.length - need);
}
