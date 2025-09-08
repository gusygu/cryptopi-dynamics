import { NextResponse } from 'next/server';
import { buildLatestPayload } from '@/core/matricesLatest';

export async function GET() {
  const coins = (process.env.COINS ?? 'BTC,ETH,BNB,SOL,ADA,XRP,DOGE,USDT')
    .split(',').map(s=>s.trim().toUpperCase());
  const payload = await buildLatestPayload(coins);
  return NextResponse.json(payload);
}
