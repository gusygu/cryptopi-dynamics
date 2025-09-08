// src/converters/provider.types.ts
export type Pair = { base: string; quote: string };

export type SwapDirection = "up" | "down" | "frozen";
export type SwapTag = { count: number; direction: SwapDirection; changedAtIso?: string };

export type VTendency = "up" | "down" | "flat" | undefined;
export type Inertia = "low" | "neutral" | "high" | "frozen" | undefined;

// matrices
export interface MatricesProvider {
  prepare?(coins: string[]): Promise<void> | void;
  getBenchmarkGrid(coins: string[]): Promise<number[][] | undefined> | number[][] | undefined;
  getIdPctGrid(coins: string[]): Promise<number[][] | undefined> | number[][] | undefined;
}

// cin-aux
export type CinStat = { session: { imprint: number; luggage: number }; cycle: { imprint: number; luggage: number } };
export interface CinAuxProvider {
  getWallet(symbol: string): Promise<number | undefined> | number | undefined;
  getCinForCoins(symbols: string[]): Promise<Record<string, CinStat>> | Record<string, CinStat>;
}

// mea-aux
export interface MeaAuxProvider {
  getMea(pair: Pair): Promise<{ value: number; tier: string }> | { value: number; tier: string };
  // NEW: optional full-grid computation for matrix
  getMeaGrid?(
    input: { coins: string[]; idPct: number[][]; balances: Record<string, number>; k?: number }
  ): Promise<number[][]> | number[][];
}

// str-aux
export interface StrAuxProvider {
  getSwapTag?(edge: { from: string; to: string }): Promise<SwapTag> | SwapTag; // optional legacy
  getIdPctHistory?(from: string, to: string, lastN?: number): Promise<number[]>; // ← add
  getPctDrvHistory?(from: string, to: string, lastN?: number): Promise<number[]>; // ← add
  getGfm(): Promise<number> | number;
  getShift(): Promise<number> | number;
  getVTendency(pair: Pair): Promise<number> | number;
}

// wallet http fallback
export interface WalletHttpProvider {
  getWallet(symbol: string): Promise<number | undefined> | number | undefined;
}

// universal sources
export type ConverterSources = {
  matrices: MatricesProvider;
  mea: MeaAuxProvider;
  str: StrAuxProvider;
  cin: CinAuxProvider;
  wallet?: WalletHttpProvider;
};

// domain outputs
export type DomainRowMetrics = {
  benchmark: number;
  id_pct: number;          // keep as it comes from DB (no extra scaling)
  vTendency?: VTendency;
  inertia?: Inertia;
  swapTag: SwapTag;
};
export type DomainArbRow = { ci: string; metrics: DomainRowMetrics };

// ...existing imports/types...



// Domain VM: unchanged except arb rows now carry per-column metrics (no UI coupling here)
export type DomainVM = {
  coins: string[];
  matrix: { benchmark?: number[][]; id_pct?: number[][]; mea?: number[][] };
  arb: {
    rows: Array<{
      ci: string;
      cols: {
        cb_ci: { benchmark: number; id_pct: number; vTendency?: number; swapTag: SwapTag };
        ci_ca: { benchmark: number; id_pct: number; vTendency?: number; swapTag: SwapTag };
        ca_ci: { benchmark: number; id_pct: number; vTendency?: number; swapTag: SwapTag };
      };
    }>;
    wallets: Record<string, number>;
  };
  metricsPanel: {
    mea: { value: number; tier: string };
    str: { gfm: number; shift: number; vTendency: number };
    cin: Record<string, CinStat>;
  };
};
