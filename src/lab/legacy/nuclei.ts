// legacy-friendly nuclei adapter → delegates to idhr.ts

import type { Nucleus } from "../str-aux/idhr";
import { extractNuclei, type IdhrBins } from "../str-aux/idhr";

export type { Nucleus };

/** Extract top-N nuclei from IDHR bins (densest first). */
export function nucleiFromBins(bins: IdhrBins, topN?: number): Nucleus[] {
  return extractNuclei(bins, topN ?? 3);
}
