import { NextResponse } from "next/server";
import { getAccountBalances } from "@/sources/binanceAccount";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (process.env.WALLET_ENABLED !== 'true') {
    return NextResponse.json({ ok: false, error: 'Wallet disabled' }, { status: 403 });
  }
  try {
    const balances = await getAccountBalances();
    return NextResponse.json({ ok: true, balances });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}