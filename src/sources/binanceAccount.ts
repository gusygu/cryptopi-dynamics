/**
 * Wallet fetch using the binanceClient with:
 * - response hardening
 * - 40s result cache (to align with project cycles)
 */

import { signedGET } from "./binanceClient";

export type BalancesMap = Record<string, number>;

const WALLET_TTL_MS = 40000;

let cacheAt = 0;
let cacheData: BalancesMap | null = null;

/** Clear wallet cache (optional: for tests/manual refresh) */
export function clearWalletCache() {
  cacheAt = 0;
  cacheData = null;
}

export async function getAccountBalances(): Promise<BalancesMap> {
  const now = Date.now();
  if (cacheData && now - cacheAt < WALLET_TTL_MS) {
    return cacheData;
  }

  // endpoint: GET /api/v3/account  (SIGNED)
  type AccountResp = {
    makerCommission?: number;
    takerCommission?: number;
    buyerCommission?: number;
    sellerCommission?: number;
    canTrade?: boolean;
    canWithdraw?: boolean;
    canDeposit?: boolean;
    updateTime?: number;
    accountType?: string;
    balances?: Array<{ asset: string; free: string; locked?: string }>;
    permissions?: string[];
  };

  // If keys are missing, signedGET will throw. Catch to return {} gracefully.
  let data: AccountResp;
  try {
    data = await signedGET<AccountResp>("/api/v3/account");
  } catch (e: any) {
    // Soft-fail: return empty map so callers can render zeros
    console.warn(`getAccountBalances: ${e?.message ?? e}`);
    cacheData = {};
    cacheAt = now;
    return cacheData;
  }

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
}
