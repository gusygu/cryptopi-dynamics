/* ----------------------------------------------------------------------------------
* File: src/converters/providers/moduleProvider.ts
* ---------------------------------------------------------------------------------- */


import type { ConverterProvider } from "@/converters/provider.types";


// Provide your own service functions here (pure, not Next route handlers)
export type ModuleDeps = {
getMatrix: (coins: string[], fields?: string[]) => Promise<{ coins: string[]; benchmark?: number[][] }>;
getDerived: (coins: string[]) => Promise<{ coins: string[]; id_pct: number[][] }>;
getWallet?: (symbol: string) => Promise<number> | number;
getIdPctHistory?: (from: string, to: string, lastN?: number) => Promise<number[]> | number[];
};


function buildLookup(coins: string[], grid?: number[][]) {
const idx = new Map<string, number>(coins.map((c, i) => [c, i]));
return (from: string, to: string): number | undefined => {
if (!grid) return undefined;
const i = idx.get(from), j = idx.get(to);
if (i == null || j == null) return undefined;
const row = grid[i];
return row ? row[j] : undefined;
};
}


export function makeModuleProvider(deps: ModuleDeps): ConverterProvider {
let coinsCache: string[] = [];
let bmGrid: number[][] | undefined;
let idGrid: number[][] | undefined;
let bmLookup: ((f: string, t: string) => number | undefined) | null = null;
let idLookup: ((f: string, t: string) => number | undefined) | null = null;


return {
async prepare(coins: string[]) {
const [m, d] = await Promise.all([
deps.getMatrix(coins, ["benchmark"]).catch(() => ({ coins, benchmark: undefined })),
deps.getDerived(coins).catch(() => ({ coins, id_pct: [] as number[][] })),
]);
coinsCache = m.coins ?? coins;
bmGrid = m.benchmark;
idGrid = d.id_pct;
bmLookup = buildLookup(coinsCache, bmGrid);
idLookup = buildLookup(coinsCache, idGrid);
},
getBenchmark(from, to) {
return bmLookup?.(from, to);
},
getIdPct(from, to) {
return idLookup?.(from, to);
},
getWallet(symbol) {
return deps.getWallet ? deps.getWallet(symbol) : 0;
},
getIdPctHistory(from, to, n = 6) {
return deps.getIdPctHistory ? deps.getIdPctHistory(from, to, n) : undefined;
},
} satisfies ConverterProvider;
}