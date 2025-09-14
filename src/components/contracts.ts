// src/components/contracts.ts

// Reusable UI contracts (types) to keep components lean & consistent.

export type NumGrid = number[][];

export type Wallets = Record<string, number>;

export type HistogramData = {
  edges: number[];      // bin edges (length = bins + 1)
  counts: number[];     // bin counts (length = bins)
  nuclei?: number[];    // optional “centers of mass” markers
  label?: string;       // optional axis/legend label
};

export type MatricesBundle = {
  benchmark: NumGrid;
  id_pct: NumGrid;
  pct_drv?: NumGrid;
  pct24h?: NumGrid;     // pairwise 24h % (units = %, not decimal)
};

export type AssetsIdentityProps = {
  base: string;
  quote: string;
  bridge?: string;                  // default "USDT"
  coins: string[];
  matrices: MatricesBundle;
  wallets: Wallets;
  pct24h?: Record<string, number>;  // optional coin→USDT decimal map (fallback)
  histogram?: HistogramData;        // optional precomputed histogram
  className?: string;
};
