// src/lab/aux-str/buildStrAux.ts
import type { ComputePayload, StrAuxDoc, WindowKey, Point } from "./types";
import { compactForWindow } from "./circular";
import { idhr } from "./idhr";
import { computeStats } from "./stats";
import { layoutHash } from "@/lib/str-aux/layoutHash";

/**
 * Orchestrates: points → IDHR → Stats → Stream aggregation → StrAuxDoc
 * Notes:
 * - `refGfm` should come from previously persisted doc for delta/shift.
 * - Stream triples accept external metrics (prev/cur) and keep greatest (abs).
 * - Returns a Promise because layoutHash is async (Edge/WebCrypto fallback).
 */
export async function buildStrAux(input: ComputePayload, prev?: StrAuxDoc): Promise<StrAuxDoc> {
  const pair = { ...input.pair, appSessionId: input.pair.appSessionId ?? "dev-session" };
  const window = pair.window as WindowKey;

  const points: Point[] = compactForWindow(input.points ?? [], window);
  const idhrRes = idhr(points);

  const refGfm = prev?.stats?.gfm ?? prev?.stats?.refGfm;
  const stats = computeStats(points, idhrRes, refGfm);

  const opening =
    input.opening ??
    prev?.opening ?? {
      benchmark: input.metrics?.benchmarkCur ?? 0,
      pct24h: input.metrics?.pct24hCur ?? 0,
      pct_drv: input.metrics?.pct_drvCur ?? 0,
      ts: Date.now(),
      layoutHash: await layoutHash({ pair, window }), // async hash
    };

  const mkTriple = (key: "benchmark" | "pct24h" | "pct_drv") => {
    const prevVal = input.metrics?.[`${key}Prev` as const] ?? prev?.stream?.[key]?.prev ?? 0;
    const curVal = input.metrics?.[`${key}Cur` as const] ?? prev?.stream?.[key]?.cur ?? 0;
    const greatest = Math.max(
      Math.abs(prev?.stream?.[key]?.greatest ?? 0),
      Math.abs(prevVal),
      Math.abs(curVal)
    );
    return { prev: prevVal, cur: curVal, greatest };
  };

  const stream = {
    benchmark: mkTriple("benchmark"),
    pct24h: mkTriple("pct24h"),
    pct_drv: mkTriple("pct_drv"),
  };

  const id = `${pair.base}:${pair.quote}:${pair.window}:${opening.layoutHash}`;

  return {
    id,
    pair,
    opening,
    nuclei: idhrRes.nuclei,
    stats,
    stream,
    updatedAt: Date.now(),
  };
}
