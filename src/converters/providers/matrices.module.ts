/* ----------------------------------------------------------------------------------
* 2) File: src/converters/providers/matrices.module.ts
* ---------------------------------------------------------------------------------- */


import type { MatricesProvider } from "@/converters/provider.types";


// Provide your real services (pure functions) from dynamics-matrices here.
export type MatricesModuleDeps = {
getMatrix: (coins: string[], fields?: string[]) => Promise<{ coins: string[]; benchmark?: number[][]; id_pct?: number[][] }>;
getDerived?: (coins: string[]) => Promise<{ coins: string[]; id_pct: number[][] }>; // optional if getMatrix already includes id_pct
};


export function makeMatricesModuleProvider(deps: MatricesModuleDeps): MatricesProvider {
return {
async getBenchmarkGrid(coins) {
const m = await deps.getMatrix(coins, ["benchmark"]);
return m.benchmark;
},
async getIdPctGrid(coins) {
if (deps.getDerived) {
const d = await deps.getDerived(coins);
return d.id_pct;
}
const m = await deps.getMatrix(coins, ["id_pct"]);
return m.id_pct;
},
} satisfies MatricesProvider;
}