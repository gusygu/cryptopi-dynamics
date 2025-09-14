// src/lib/dynamics.gateway.server.ts
import "server-only";
import type {
  Coins, Grid, MatricesPayload, StrBinsResp, PreviewResp,
} from "@/lib/dynamics.contracts";

/** Resolve a base URL for server-side fetch fallbacks */
function baseURL() {
  const b = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL;
  if (b) return b.replace(/\/$/, "");
  const port = process.env.PORT || "3000";
  return `http://localhost:${port}`;
}

/* ───────────────── Matrices Latest ───────────────── */
// TODO: Prefer direct provider wiring here (e.g., import matrices service)
// import { getLatestMatrices } from "@/matrices/service"; // ← when ready
export async function getMatricesLatest(coins?: Coins, init?: RequestInit): Promise<MatricesPayload> {
  const url = new URL("/api/matrices/latest", baseURL());
  if (coins?.length) url.searchParams.set("coins", coins.join(","));
  url.searchParams.set("t", String(Date.now()));
  const r = await fetch(url, { cache: "no-store", ...init });
  if (!r.ok) throw new Error(`matrices latest ${r.status}`);
  return (await r.json()) as MatricesPayload;
}

/* ───────────────── MEA grid ───────────────── */
// TODO: import from "auxiliary/mea-aux/server" once you want to bypass HTTP
export async function getMeaGrid(coins: Coins, init?: RequestInit): Promise<Grid | undefined> {
  const url = new URL("/api/mea-aux", baseURL());
  if (coins?.length) url.searchParams.set("coins", coins.join(","));
  url.searchParams.set("t", String(Date.now()));
  const r = await fetch(url, { cache: "no-store", ...init });
  if (!r.ok) return undefined;
  const j = (await r.json()) as { ok: boolean; grid?: Grid };
  return j?.grid;
}

/* ───────────────── STR bins ───────────────── */
// TODO: import from your STR/Vm service when ready
export async function getStrBins(params: {
  pairs: string; window?: string; bins?: string; sessionId?: string;
}, init?: RequestInit): Promise<StrBinsResp | undefined> {
  const url = new URL("/api/str-aux/bins", baseURL());
  url.searchParams.set("pairs", params.pairs);
  if (params.window) url.searchParams.set("window", params.window);
  if (params.bins)   url.searchParams.set("bins", params.bins);
  if (params.sessionId) url.searchParams.set("sessionId", params.sessionId);
  url.searchParams.set("t", String(Date.now()));
  const r = await fetch(url, { cache: "no-store", ...init });
  if (!r.ok) return undefined;
  return (await r.json()) as StrBinsResp;
}

/* ───────────────── Preview symbols ───────────────── */
export async function getPreviewSymbols(init?: RequestInit): Promise<string[]> {
  const url = new URL("/api/providers/binance/preview", baseURL());
  url.searchParams.set("t", String(Date.now()));
  const r = await fetch(url, { cache: "no-store", ...init });
  if (!r.ok) return [];
  const j = (await r.json()) as PreviewResp;
  return (j?.symbols ?? []).map((s) => s.toUpperCase());
}
