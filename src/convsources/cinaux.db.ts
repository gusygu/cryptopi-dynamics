/* ----------------------------------------------------------------------------------
* 5) File: src/converters/providers/cinaux.db.ts
* ---------------------------------------------------------------------------------- */


import type { CinAuxProvider, CinStat } from "@/converters/provider.types";


export type CinDbDeps = {
getWallet: (symbol: string) => Promise<number | null>;
getCinStats: (symbols: string[]) => Promise<Array<{ symbol: string; session_imprint: number; session_luggage: number; cycle_imprint: number; cycle_luggage: number }>>;
};


export function makeCinDbProvider(db: CinDbDeps): CinAuxProvider {
return {
async getWallet(symbol) {
const v = await db.getWallet(symbol);
return v ?? 0;
},
async getCinForCoins(symbols) {
const rows = await db.getCinStats(symbols);
const out: Record<string, CinStat> = {};
for (const r of rows) {
out[r.symbol] = {
session: { imprint: r.session_imprint, luggage: r.session_luggage },
cycle: { imprint: r.cycle_imprint, luggage: r.cycle_luggage },
};
}
// default zeros if missing
for (const s of symbols) if (!out[s]) out[s] = { session: { imprint: 0, luggage: 0 }, cycle: { imprint: 0, luggage: 0 } };
return out;
},
} satisfies CinAuxProvider;
}