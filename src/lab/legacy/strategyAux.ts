import {
  MarketPoint, OpeningExact, StrategyAuxInput, StrategyAuxResult,
  StrValues, FloatingModeLite
} from "../str-aux/types";
import { toOhlc } from "./ohlcVwap";
import { computeFloatingModeIDHR } from "../str-aux/idhr";

const num = (x: any, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);

function bucketMsFromWin(win?: "30m" | "1h" | "3h") {
  switch (win) {
    case "1h": return 60 * 60 * 1000;
    case "3h": return 3 * 60 * 60 * 1000;
    default:   return 30 * 60 * 1000;
  }
}

/** derive bands from OHLC/VWAP + series extras (spreadPct) */
function bandsFromSeries(points: MarketPoint[], opening: OpeningExact): StrValues {
  const bucketMs = bucketMsFromWin(undefined);
  const ob = toOhlc(points, bucketMs, { mode: "topPct", n: 0.2 }); // Top 20% liquidity VWAP

  // benchmark (price-based)
  const prev = num(points.at(-2)?.price, opening.benchmark);
  const cur  = num(points.at(-1)?.price, opening.benchmark);
  const maxT = ob.summary.high;
  const minT = ob.summary.low;

  // pct24h abs carried from opening for now
  const pctPrev = opening.pct24h;
  const pctCur  = opening.pct24h;

  // id_pct from spreadPct stream
  const spreads = points.map(p => num(p.spreadPct, NaN)).filter(Number.isFinite);
  const idPrev = num(points.at(-2)?.spreadPct, 0);
  const idCur  = num(points.at(-1)?.spreadPct, idPrev);
  const idMax  = spreads.length ? Math.max(...spreads) : idCur;
  const idMin  = spreads.length ? Math.min(...spreads) : idCur;

  return {
    benchmark: {
      abs:   { prev, cur, maxTurn: maxT, minTurn: minT },
      quant: {
        prev: num(ob.summary.vwap, prev),
        cur:  num(ob.summary.vwap, cur),
        maxTurn: num(ob.summary.vwapTopN, maxT),
        minTurn: num(ob.summary.vwapTopN, minT),
      },
    },
    pct24h: {
      abs:   { prev: pctPrev, cur: pctCur, maxTurn: pctCur, minTurn: pctPrev },
      quant: { prev: 0, cur: 0, maxTurn: 1, minTurn: 0 },
    },
    id_pct: {
      abs:   { prev: idPrev, cur: idCur, maxTurn: idMax, minTurn: idMin },
      quant: { prev: 0, cur: 1, maxTurn: 1, minTurn: 0 },
    },
  };
}

export function buildStrategyAux(input: StrategyAuxInput): StrategyAuxResult {
  const { opening, points, metrics, latestTs } = input;

  // 1) values from series
  const strValues = bandsFromSeries(points, opening);

  // 2) Floating Mode from IDHR
  const fm: FloatingModeLite = computeFloatingModeIDHR(points, opening);

  // 3) allow explicit overrides from metrics
  if (Number.isFinite(Number(metrics?.benchmarkCur))) strValues.benchmark.abs.cur = Number(metrics!.benchmarkCur);
  if (Number.isFinite(Number(metrics?.benchmarkPrev))) strValues.benchmark.abs.prev = Number(metrics!.benchmarkPrev);
  if (Number.isFinite(Number(metrics?.pct24hCur)))    strValues.pct24h.abs.cur     = Number(metrics!.pct24hCur);
  if (Number.isFinite(Number(metrics?.pct24hPrev)))   strValues.pct24h.abs.prev    = Number(metrics!.pct24hPrev);
  if (Number.isFinite(Number(metrics?.idPctCur)))     strValues.id_pct.abs.cur     = Number(metrics!.idPctCur);
  if (Number.isFinite(Number(metrics?.idPctPrev)))    strValues.id_pct.abs.prev    = Number(metrics!.idPctPrev);

  // 4) attach OHLC bundle for inspection (whole-turn bucket)
  const ohlc = toOhlc(points, bucketMsFromWin(undefined), { mode: "topPct", n: 0.2 });

  return { opening, fm, strValues, ohlc, tendencies: { latestTs } };
}

export function assembleStrategyAux(
  opening: OpeningExact,
  fm: FloatingModeLite,
  metrics: StrategyAuxInput["metrics"],
  latestTs: number,
  _nShifts: number,
  _timelapseSec: number,
  _settled: boolean,
  _prevExtrema?: any
): StrategyAuxResult {
  const n = (x: any, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);
  const sv: StrValues = {
    benchmark: {
      abs:   { prev: n(metrics?.benchmarkPrev, opening.benchmark), cur: n(metrics?.benchmarkCur, opening.benchmark), maxTurn: 0, minTurn: 0 },
      quant: { prev: 0, cur: 0, maxTurn: 0, minTurn: 0 },
    },
    pct24h: {
      abs:   { prev: n(metrics?.pct24hPrev, opening.pct24h), cur: n(metrics?.pct24hCur, opening.pct24h), maxTurn: 0, minTurn: 0 },
      quant: { prev: 0, cur: 0, maxTurn: 1, minTurn: 0 },
    },
    id_pct: {
      abs:   { prev: n(metrics?.idPctPrev, opening.id_pct), cur: n(metrics?.idPctCur, opening.id_pct), maxTurn: 0, minTurn: 0 },
      quant: { prev: 0, cur: 1, maxTurn: 1, minTurn: 0 },
    },
  };
  return { opening, fm, strValues: sv, tendencies: { latestTs } };
}
