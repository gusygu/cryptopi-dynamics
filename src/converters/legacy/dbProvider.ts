/* ----------------------------------------------------------------------------------
* File: src/converters/providers/dbProvider.ts
* ---------------------------------------------------------------------------------- */


import type { ConverterProvider } from "@/converters/provider.types";


// Example Prisma-like API; adapt to your schema.
export type DbDeps = {
// return single cells
getBenchmarkCell: (from: string, to: string) => Promise<number | null>;
getIdPctCell: (from: string, to: string) => Promise<number | null>;
getWallet?: (symbol: string) => Promise<number | null>;
getIdPctHistory?: (from: string, to: string, lastN?: number) => Promise<number[]>;
};


export function makeDbProvider(db: DbDeps): ConverterProvider {
return {
async getBenchmark(from, to) {
const v = await db.getBenchmarkCell(from, to);
return v ?? undefined;
},
async getIdPct(from, to) {
const v = await db.getIdPctCell(from, to);
return v ?? undefined;
},
async getWallet(symbol) {
const v = await db.getWallet?.(symbol);
return v ?? 0;
},
async getIdPctHistory(from, to, n = 6) {
return db.getIdPctHistory ? db.getIdPctHistory(from, to, n) : undefined;
},
} satisfies ConverterProvider;
}