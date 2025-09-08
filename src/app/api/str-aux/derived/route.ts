// src/app/api/str-aux/derived/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { fetch24hAll, mapTickerBySymbol } from '@/sources/binance';
import { buildPrimaryDirect, buildDerived } from '@/core/math/matrices';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const coinsStr = searchParams.get('coins') ?? process.env.COINS ?? 'BTC,ETH,BNB,ADA,SOL,USDT';
  const coins = coinsStr.split(',').map(s => s.trim()).filter(Boolean);
  const ts_ms = Date.now();

  try {
    const rows = await fetch24hAll();
    const tmap = mapTickerBySymbol(rows);
    const { benchmark } = buildPrimaryDirect(coins, tmap);

    // TODO: replace with real DB lookups
    const getPrev = async () => null;

    const { id_pct, pct_drv } = await buildDerived(coins, ts_ms, benchmark, getPrev);
    return NextResponse.json({ ok: true, ts: ts_ms, coins, id_pct, pct_drv });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'error' }, { status: 500 });
  }
}
