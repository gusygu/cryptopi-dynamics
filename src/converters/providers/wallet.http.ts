/* ----------------------------------------------------------------------------------
* 6) File: src/converters/providers/wallet.http.ts
* ---------------------------------------------------------------------------------- */


import type { WalletHttpProvider } from "@/converters/provider.types";


export function makeWalletHttpProvider(base = "/api/wallet"): WalletHttpProvider {
return {
async getWallet(symbol) {
try {
const r = await fetch(`${base}?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
if (!r.ok) return 0;
const j = await r.json();
const v = Number(j?.balance);
return Number.isFinite(v) ? v : 0;
} catch { return 0; }
},
} satisfies WalletHttpProvider;
}