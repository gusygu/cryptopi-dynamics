/* ----------------------------------------------------------------------------------
* 4) File: src/converters/providers/straux.db.ts
* ---------------------------------------------------------------------------------- */


import type { StrAuxProvider, SwapDirection, SwapTag, Pair } from "@/converters/provider.types";


export type StrDbDeps = {
getIdPctHistory: (from: string, to: string, lastN?: number) => Promise<number[]>;
getGfm: () => Promise<number>;
getShift: () => Promise<number>;
getVTendency: (pair: Pair) => Promise<number>;
};


export function makeStrDbProvider(db: StrDbDeps): StrAuxProvider {
function swapFromHist(hist: number[]): SwapTag {
let count = 0; let direction: SwapDirection = "frozen";
for (let i = 1; i < hist.length; i++) {
const ps = Math.sign(hist[i - 1] ?? 0);
const cs = Math.sign(hist[i] ?? 0);
if (ps !== cs && cs !== 0) count++;
}
const last = hist[hist.length - 1] ?? 0;
direction = last > 0 ? "up" : last < 0 ? "down" : "frozen";
return { count, direction };
}
return {
async getSwapTag({ from, to }) {
const h = await db.getIdPctHistory(from, to, 6);
return swapFromHist(h);
},
getGfm: () => db.getGfm(),
getShift: () => db.getShift(),
getVTendency: (pair) => db.getVTendency(pair),
} satisfies StrAuxProvider;
}