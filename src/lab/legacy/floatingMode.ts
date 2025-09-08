// legacy-friendly FM adapter → delegates to idhr.ts

import type { MarketPoint, OpeningExact, FloatingModeLite } from "../str-aux/types";
import { computeFloatingModeIDHR, type IdhrConfig } from "../str-aux/idhr";

/** Compute Floating Mode from IDHR density (μ/D/z, vInner/vOuter, σ). */
export function computeFloatingMode(
  points: MarketPoint[],
  opening: OpeningExact,
  cfg: Partial<IdhrConfig> = {}
): FloatingModeLite {
  return computeFloatingModeIDHR(points, opening, cfg);
}
