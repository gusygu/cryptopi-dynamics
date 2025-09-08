/* ----------------------------------------------------------------------------------
* 3) File: src/converters/providers/meaaux.module.ts
* ---------------------------------------------------------------------------------- */


import type { MeaAuxProvider, Pair } from "@/converters/provider.types";


export type MeaModuleDeps = {
getMeaForPair: (pair: Pair) => Promise<{ value: number; tier: string }>;
};


export function makeMeaModuleProvider(deps: MeaModuleDeps): MeaAuxProvider {
return {
getMea(pair) { return deps.getMeaForPair(pair); },
} satisfies MeaAuxProvider;
}