// app/api/wallet/balances/route.ts
import { NextResponse } from 'next/server';
import { getAccountBalances } from '@/sources/binanceAccount';

export async function GET() {
  if (process.env.WALLET_ENABLED !== 'true') {
    return NextResponse.json({ ok: false, error: 'Wallet disabled' }, { status: 403 });
  }
  try {
    const balances = await getAccountBalances();
    return NextResponse.json({ ok: true, balances });
  } catch (e:any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'wallet error' }, { status: 500 });
  }
}
