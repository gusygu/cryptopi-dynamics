// Rebrand facade: keep using the lean str-aux guts with a stable public name.
// This lets the rest of the app import from "@/lab/aux-strategy" going forward.

export { layoutHash } from "../../lib/str-aux/layoutHash";
export { computeStats } from "../str-aux/stats";
export { compactForWindow } from "../str-aux/circular";
export { useStrategyAux as useAuxStrategy } from "./hooks/useStrAux";
export { buildStrAux } from "../str-aux/buildStrAux";
export * from "../str-aux/types";
export * from "./ohlcVwap";
export * from "../str-aux/idhr";
export * from "./strategyAux";
