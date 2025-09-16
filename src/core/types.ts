// src/core/types.ts
export type MatrixType = 'benchmark'|'delta'|'pct24h'|'id_pct'|'pct_drv';
// src/core/types.ts
export type Coin = string;

export type PollerSettings = {
  /** canonical 40s tick (or whatever you pick) */
  dur40?: number;      // seconds
  /** optional shorter/longer cadences if you use them */
  dur10?: number;
  dur60?: number;
};

export type TimingSettings = {
  /** lookback window in milliseconds used by derived math (id_pct, pct_drv) */
  lookbackMs?: number;
};

export type AppSettings = {
  /** main coin universe for all pages (Matrices, Aux, Str-Aux, etc.) */
  coinUniverse?: Coin[];
  coins?: string[];              // <-- add this

  /** server metronome/pipeline intervals */
  poller?: PollerSettings;
  metronome?: PollerSettings;

  /** math-logic timing knobs */
  timing?: TimingSettings;

  /** keep everything else calmly indexable to avoid type breakages */
  [k: string]: any;
};
