// src/converters/Converter.server.ts
// SERVER-ONLY: provider wiring + VM builder (NO React hooks here)

import type {
  ConverterSources,
  DomainVM,
  SwapTag,
  SwapDirection,
} from "@/converters/provider.types";

// ---- local types for per-column metrics (UI reads these) ----
type EdgeMetrics = {
  benchmark: number;   // display with 3–4 dp in UI
  id_pct: number;      // raw, display up to 6 dp
  vTendency?: number;  // numeric tendency per edge
  swapTag: SwapTag;    // sign flips of pct derivative (+ last change)
};

type DomainArbRow = {
  ci: string;
  cols: {
    cb_ci: EdgeMetrics; // Cb -> Ci
    ci_ca: EdgeMetrics; // Ci -> Ca
    ca_ci: EdgeMetrics; // Ca -> Ci
  };
};

// timestamped point used by pct_drv/id_pct histories
type TimedPoint = { ts_ms: number; value: number };

let sourcesRef: ConverterSources | null = null;
export function wireConverterSources(s: ConverterSources) {
  sourcesRef = s;
}

// ---- small safe-call helpers (support sync/async + swallow errors) ----
async function tryCall<T>(fn: () => Promise<T> | T): Promise<T | undefined> {
  try { return await fn(); } catch { return undefined; }
}
async function tryCallOr<T>(fn: () => T | Promise<T>, fallback: T): Promise<T> {
  try {
    const v = await Promise.resolve(fn());
    return (v as any) ?? fallback;
  } catch {
    return fallback;
  }
}

function swapTagFromDerivatives(derivs?: number[]): SwapTag {
  if (!derivs || derivs.length === 0) return { count: 0, direction: "frozen" };
  let prev = 0;
  let flips = 0;
  for (const d of derivs as number[]) {
    const s = Math.sign(d);
    if (s !== 0 && prev !== 0 && s !== prev) flips++;
    if (s !== 0) prev = s;
  }
  const last = (derivs as number[])[(derivs as number[]).length - 1] ?? 0;
  const direction: SwapDirection = last > 0 ? "up" : last < 0 ? "down" : "frozen";
  const frozen5 = (derivs as number[]).slice(-5).every((x: number) => Math.sign(x) === 0);
  return { count: frozen5 ? 0 : flips, direction: frozen5 ? "frozen" : direction };
}

export type BuildVMOpts = {
  Ca: string;
  Cb: string;
  candidates: string[];
  coinsUniverse: string[];
  histLen?: number; // optional override for pair series length (histogram)
};

export async function buildDomainVM(opts: BuildVMOpts): Promise<DomainVM> {
  if (!sourcesRef) {
    throw new Error("Converter sources not wired — call wireConverterSources() on the server.");
  }
  const sources = sourcesRef as ConverterSources;
  const { Ca, Cb, candidates, coinsUniverse } = opts;
  const H = Math.max(16, Number(opts.histLen ?? 64)); // pair-level history length

  // 1) Matrices
  const bmGrid = await tryCall(() => sources.matrices.getBenchmarkGrid(coinsUniverse));
  const idGrid = await tryCall(() => sources.matrices.getIdPctGrid(coinsUniverse));

  // 2) Balances (all coins; useful for other converters)
  const balancesAll: Record<string, number> = {};
  for (const sym of coinsUniverse) {
    const v = await tryCall(() => sources.cin.getWallet(sym));
    const httpV = v ?? (await tryCall(() => sources.wallet?.getWallet(sym as any)));
    balancesAll[sym] = typeof httpV === "number" && isFinite(httpV) ? httpV : 0;
  }

  // 3) CIN-aux stats for the selected pair coins
  const cinStats =
    (await tryCall(() => sources.cin.getCinForCoins([Ca, Cb]))) ?? ({} as DomainVM["metricsPanel"]["cin"]);

  // 4) MEA-aux for the selected pair
  const meaPair = await tryCallOr(() => sources.mea.getMea({ base: Ca, quote: Cb }), {
    value: 1,
    tier: "γ-tier",
  });

  // 5) STR-aux globals for the pair (prefer full stats if provider has them)
  const pairStats =
    (await tryCall(() => (sources.str as any).getStats?.({ base: Ca, quote: Cb }))) ?? undefined;

  const gfm           = pairStats?.gfm   ?? (await tryCallOr(() => sources.str.getGfm(), 0));
  const shift         = pairStats?.shift ?? (await tryCallOr(() => sources.str.getShift(), 0));
  const vTendencyPair = pairStats?.vOuter ?? (await tryCallOr(() => sources.str.getVTendency({ base: Ca, quote: Cb }), 0));

  // 6) Pair-level series for histogram (pct_drv preferred; else Δ id_pct)
  const idHistPair: number[] =
    (await tryCall(() => sources.str.getIdPctHistory?.(Ca, Cb, H))) ?? [];

  const pctDrvPair: number[] =
    (await tryCall(() => (sources.str as any).getPctDrvHistory?.(Ca, Cb, H))) ??
    (() => {
      const out: number[] = [];
      for (let i = 1; i < idHistPair.length; i++) {
        out.push((idHistPair[i] ?? 0) - (idHistPair[i - 1] ?? 0));
      }
      return out;
    })();

  // helper to read a matrix cell safely
  const cell = (grid: number[][] | undefined, from: string, to: string) => {
    if (!grid) return undefined;
    const i = coinsUniverse.indexOf(from);
    const j = coinsUniverse.indexOf(to);
    if (i < 0 || j < 0) return undefined;
    return grid[i]?.[j];
  };

  // per-edge metrics builder (distinct vTendency, swapTag per edge)
  async function edgeMetrics(from: string, to: string): Promise<EdgeMetrics> {
    const bm = cell(bmGrid, from, to);
    const idp = cell(idGrid, from, to);

    const vt = await tryCallOr(() => sources.str.getVTendency({ base: from, quote: to }), 0);

    // pct-derivative for THIS edge, with timestamps if available
    let drvHistTs =
      (await tryCall(() => (sources.str as any).getPctDrvHistoryTs?.(from, to, 16))) as
        | TimedPoint[]
        | undefined;

    if (!drvHistTs || drvHistTs.length === 0) {
      const idTs = (await tryCall(
        () => (sources.str as any).getIdPctHistoryTs?.(from, to, 17)
      )) as TimedPoint[] | undefined;

      if (idTs && idTs.length >= 2) {
        const acc: TimedPoint[] = [];
        for (let k = 1; k < idTs.length; k++) {
          const curr: TimedPoint = idTs[k]!;
          const prev: TimedPoint = idTs[k - 1]!;
          acc.push({
            ts_ms: Number(curr.ts_ms),
            value: Number(curr.value ?? 0) - Number(prev.value ?? 0),
          });
        }
        drvHistTs = acc;
      }
    }

    const derivs: number[] = drvHistTs ? drvHistTs.map((o: TimedPoint) => Number(o.value ?? 0)) : [];
    const signs: number[] = derivs.map((d: number) => Math.sign(d));

    // count sign flips (ignoring zeros)
    let flips = 0;
    let prevNZ = 0;
    for (const s of signs as number[]) {
      if (s !== 0 && prevNZ !== 0 && s !== prevNZ) flips++;
      if (s !== 0) prevNZ = s;
    }

    // find last flip index + direction based on change of sign
    let lastFlipIdx = -1;
    prevNZ = 0;
    for (let i = 0; i < signs.length; i++) {
      const s: number = signs[i]!;
      if (s !== 0 && prevNZ !== 0 && s !== prevNZ) lastFlipIdx = i;
      if (s !== 0) prevNZ = s;
    }

    let direction: SwapDirection = "frozen";
    let changedAtIso: string | undefined;
    if (lastFlipIdx >= 0) {
      // determine old vs new sign around the flip
      let prevSign = 0;
      for (let k = lastFlipIdx - 1; k >= 0; k--) {
        const s: number = signs[k]!;
        if (s !== 0) { prevSign = s; break; }
      }
      const newSign: number = signs[lastFlipIdx]!;
      direction = prevSign < newSign ? "up" : "down";
      const ts_ms = drvHistTs?.[lastFlipIdx]?.ts_ms;
      if (typeof ts_ms === "number" && isFinite(ts_ms)) {
        changedAtIso = new Date(ts_ms).toISOString();
      }
    }

    // frozen if last 5 signs are identical (including 0)
    const last5: number[] = signs.slice(-5);
    const frozen = last5.length >= 5 && last5.every((v: number) => v === last5[0]);
    if (frozen) direction = "frozen";

    const swapTag: SwapTag = { count: flips, direction, changedAtIso };

    return {
      benchmark: typeof bm === "number" ? bm : 0,
      id_pct: typeof idp === "number" ? idp : 0,
      vTendency: vt,
      swapTag,
    };
  }

  // 7) Build arbitrage rows (distinct metrics for each of the 3 path cells)
  const rows: DomainArbRow[] = [];
  for (const Ci of candidates) {
    const [m1, m2, m3] = await Promise.all([
      edgeMetrics(Cb, Ci), // Cb -> Ci
      edgeMetrics(Ci, Ca), // Ci -> Ca
      edgeMetrics(Ca, Ci), // Ca -> Ci
    ]);
    rows.push({ ci: Ci, cols: { cb_ci: m1, ci_ca: m2, ca_ci: m3 } });
  }

  // limit wallets to Ca/Cb + candidates for ArbTable
  const subsetWallets: Record<string, number> = {};
  for (const sym of new Set([Ca, Cb, ...candidates])) {
    subsetWallets[sym] = balancesAll[sym] ?? 0;
  }

  // 8) FINAL VM (include pair series for the histogram)
  const vmOut = {
    coins: coinsUniverse,
    matrix: { benchmark: bmGrid, id_pct: idGrid, mea: undefined },
    arb: { rows, wallets: subsetWallets },
    metricsPanel: {
      mea: meaPair,
      str: { gfm, shift, vTendency: vTendencyPair },
      cin: cinStats,
    },
    series: { pct_drv: pctDrvPair, id_pct: idHistPair },
  } as const;

  // Cast to DomainVM while shared types migrate (per-column rows + series)
  return vmOut as unknown as DomainVM;
}
