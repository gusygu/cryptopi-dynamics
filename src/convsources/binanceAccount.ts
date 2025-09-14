/**
 * Signed-account adapter (no separate binanceClient.ts needed).
 * - GET /api/v3/account (SIGNED)
 * - Response hardening
 * - 40s result cache to align with project cycles
 */

import crypto from "crypto";

export type BalancesMap = Record<string, number>;

const BASE = process.env.BINANCE_BASE ?? "https://api.binance.com";
const API_KEY =
  process.env.BINANCE_API_KEY ??
  process.env.BINANCE_KEY ??               // fallback
  "";
const API_SECRET =
  process.env.BINANCE_API_SECRET ??
  process.env.BINANCE_SECRET ??            // fallback
  "";

// ---- signed client (inlined) ------------------------------------------------

let timeSkewMs = 0; // serverTime - localTime; maintained automatically

function qs(params: Record<string, any>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => [k, typeof v === "string" ? v : String(v)] as [string, string]);
  // Binance doesn't require sorting, but it’s nice for consistency:
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

function sign(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

async function getJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  // Try to parse JSON (Binance error bodies are JSON with code/msg)
  const body = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    const msg = (body && body.msg) || (typeof body === "string" ? body : res.statusText);
    const code = body && typeof body === "object" ? body.code : undefined;
    const err = new Error(`HTTP ${res.status}${code ? ` (${code})` : ""}: ${msg}`);
    (err as any).code = code;
    throw err;
  }
  return body as T;
}

async function fetchServerTime(): Promise<number> {
  const url = new URL("/api/v3/time", BASE).toString();
  const j = await getJson<{ serverTime: number }>(url);
  return Number(j?.serverTime ?? Date.now());
}

/**
 * Signed GET with automatic time-skew recovery (-1021).
 * Throws if API credentials are missing.
 */
async function signedGET<T = any>(path: string, query: Record<string, any> = {}): Promise<T> {
  if (!API_KEY || !API_SECRET) {
    throw new Error("Missing BINANCE_API_KEY / BINANCE_API_SECRET");
  }

  const recvWindow = Number(query.recvWindow ?? 5000);
  const timestamp = Date.now() + timeSkewMs;

  const baseParams = { ...query, recvWindow, timestamp };
  const payload = qs(baseParams);
  const sig = sign(payload, API_SECRET);

  const url = new URL(path, BASE);
  url.search = `${payload}&signature=${sig}`;

  const headers = { "X-MBX-APIKEY": API_KEY };

  try {
    return await getJson<T>(url.toString(), { headers, cache: "no-store" });
  } catch (e: any) {
    // Handle timestamp out of range (-1021): fetch server time once and retry
    if (e && (e.code === -1021 || /-1021/.test(String(e.message)))) {
      try {
        const serverTime = await fetchServerTime();
        timeSkewMs = serverTime - Date.now();
      } catch {
        // ignore skew update errors; will rethrow original
      }
      // retry once
      const ts2 = Date.now() + timeSkewMs;
      const p2 = { ...query, recvWindow, timestamp: ts2 };
      const payload2 = qs(p2);
      const sig2 = sign(payload2, API_SECRET);
      const url2 = new URL(path, BASE);
      url2.search = `${payload2}&signature=${sig2}`;
      return await getJson<T>(url2.toString(), { headers, cache: "no-store" });
    }
    throw e;
  }
}

// ---- wallet facade (preserved behavior) ------------------------------------

const WALLET_TTL_MS = 40_000;

let cacheAt = 0;
let cacheData: BalancesMap | null = null;

/** Clear wallet cache (optional: for tests/manual refresh) */
export function clearWalletCache() {
  cacheAt = 0;
  cacheData = null;
}

/**
 * Returns a map: { ASSET -> free balance }, e.g. { BTC: 0.01, USDT: 123.45 }
 * Soft-fails to {} when credentials are missing or request fails.
 */
export async function getAccountBalances(): Promise<BalancesMap> {
  const now = Date.now();
  if (cacheData && now - cacheAt < WALLET_TTL_MS) {
    return cacheData;
  }

  // endpoint: GET /api/v3/account  (SIGNED)
  type AccountResp = {
    balances?: Array<{ asset: string; free: string; locked?: string }>;
  };

  try {
    const data = await signedGET<AccountResp>("/api/v3/account");
    const out: BalancesMap = {};
    const arr = Array.isArray(data?.balances) ? data!.balances! : [];
    for (const b of arr) {
      const asset = String(b.asset || "").trim();
      if (!asset) continue;
      const free = Number(b.free);
      if (Number.isFinite(free)) out[asset] = free;
    }
    cacheData = out;
    cacheAt = now;
    return out;
  } catch (e: any) {
    // Soft-fail: return empty map so callers can render zeros
    console.warn(`getAccountBalances: ${e?.message ?? e}`);
    cacheData = {};
    cacheAt = now;
    return cacheData;
  }
}

// Optional: export the signed helper if other modules need it in the future.
export const _internal = { signedGET, fetchServerTime };
