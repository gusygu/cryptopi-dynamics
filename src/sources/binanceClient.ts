// src/sources/binanceClient.ts
// Minimal stub to satisfy type-checks in wallet balances route.
// Replace with a real implementation if/when wallet is enabled.

export type AccountBalance = { asset: string; free: string; locked?: string };

export async function signedGET<T = any>(path: string, params: Record<string, any> = {}): Promise<T> {
  // Stub: throw to let callers handle gracefully when keys are not configured
  throw new Error('Binance signed client not configured');
}

export async function getAccountBalances(): Promise<AccountBalance[]> {
  // Optional helper; not used by wallet route after switch to binanceAccount
  return [];
}
