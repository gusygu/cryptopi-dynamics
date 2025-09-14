// /src/app/api/providers/binance/wallet/route.ts
import { NextResponse } from "next/server";

// adjust the import path if your adapter lives elsewhere:
import { getAccountBalances } from "@/sources/binanceAccount";

export async function GET() {
  try {
    const wallets = await getAccountBalances();
    return NextResponse.json(
      { ok: true, wallets },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    // Soft-fail: empty map so UI can render zeros
    return NextResponse.json(
      { ok: true, wallets: {}, warn: e?.message ?? "wallet fetch failed" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
