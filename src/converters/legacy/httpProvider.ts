/* ----------------------------------------------------------------------------------
* File: src/converters/providers/httpProvider.ts
* ---------------------------------------------------------------------------------- */


import type { ConverterProvider } from "@/converters/provider.types";


type MatricesResp = { coins: string[]; benchmark?: number[][]; pct24h?: number[][] };
type DerivedResp = { coins: string[]; id_pct: number[][] };


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


export function makeHttpProvider(base = "/api/str-aux"): ConverterProvider {
let coinsCache: string[] = [];
let bmGrid: number[][] | undefined;
let idGrid: number[][] | undefined;
let bmLookup: ((f: string, t: string) => number | undefined) | null = null;
let idLookup: ((f: string, t: string) => number | undefined) | null = null;


async function fetchPrimary(coins: string[]) {
const u = `${base}/matrix?coins=${encodeURIComponent(coins.join(","))}&fields=benchmark`;
const r = await fetch(u, { cache: "no-store" });
if (!r.ok) throw new Error(`httpProvider matrix ${r.status}`);
const json = (await r.json()) as MatricesResp;
bmGrid = json.benchmark;
coinsCache = json.coins ?? coins;
bmLookup = buildLookup(coinsCache, bmGrid);
}
async function fetchDerived(coins: string[]) {
const u = `${base}/derived?coins=${encodeURIComponent(coins.join(","))}`;
const r = await fetch(u, { cache: "no-store" });
if (!r.ok) throw new Error(`httpProvider derived ${r.status}`);
const json = (await r.json()) as DerivedResp;
idGrid = json.id_pct;
coinsCache = json.coins ?? coins;
idLookup = buildLookup(coinsCache, idGrid);
}


return {
async prepare(coins: string[]) {
await Promise.all([fetchPrimary(coins).catch(() => {}), fetchDerived(coins).catch(() => {})]);
},
getBenchmark(from, to) {
return bmLookup?.(from, to);
},
getIdPct(from, to) {
return idLookup?.(from, to);
},
// Replace with your wallet API if available
async getWallet(symbol) {
// optional endpoint e.g. /api/wallet?symbol=SYM; default 0
return 0;
},
async getIdPctHistory(_f, _t, _n = 6) {
// If you have a history endpoint, wire it here. Fallback to undefined.
return undefined;
},
} satisfies ConverterProvider;
}