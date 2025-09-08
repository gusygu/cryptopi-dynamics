// legacy-friendly binning adapter → delegates to idhr.ts

import type { MarketPoint, OpeningExact } from "../str-aux/types";
import {
  computeIdhrBins,
  DEFAULT_IDHR,
  type IdhrConfig,
  type IdhrBins,
} from "../str-aux/idhr";

export type BinningConfig = IdhrConfig;
export type BinningBins = IdhrBins;

export const DEFAULT_BINNING: BinningConfig = DEFAULT_IDHR;

/** Produce histogram bins in log-return space (IDHR). */
export function binSeries(
  points: MarketPoint[],
  opening: OpeningExact,
  cfg: Partial<BinningConfig> = {}
): BinningBins {
  return computeIdhrBins(points, opening, cfg);
}
