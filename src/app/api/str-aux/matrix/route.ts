import { NextRequest, NextResponse } from 'next/server';
import { fetch24hAll, mapTickerBySymbol } from '@/sources/binance';
import { buildPrimaryDirect /*, buildDerived*/ } from '@/core/math/matrices';

export const dynamic = 'force-dynamic';

/**
 * GET /api/str-aux/matrix?coins=BTC,ETH,BNB&fields=benchmark,pct24h[,pct_drv]
 * - Only computes what STR needs.
 * - pct_drv requires previous snapshot; will return nulls until we wire DB prev.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const coinsStr = searchParams.get('coins') ?? process.env.COINS ?? 'BTC,ETH,BNB,ADA,SOL,USDT';
  const fieldsStr = (searchParams.get('fields') ?? 'benchmark,pct24h').toLowerCase();
  const fields = new Set(fieldsStr.split(',').map(s => s.trim()).filter(Boolean));
  const coins = coinsStr.split(',').map(s => s.trim()).filter(Boolean);

  try {
    const rows = await fetch24hAll();
    const tmap = mapTickerBySymbol(rows);
    const base = buildPrimaryDirect(coins, tmap); // { benchmark, delta, pct24h }

    const out: Record<string, unknown> = { ok: true, ts: Date.now(), coins };

    if (fields.has('benchmark')) out.benchmark = base.benchmark;
    if (fields.has('pct24h'))    out.pct24h    = base.pct24h;

    // NOTE: pct_drv depends on previous snapshot (id_pct history).
    // We'll wire DB prev in next step; for now return null grid if requested.
    if (fields.has('pct_drv')) {
      out.pct_drv = Array.from({ length: coins.length }, () => Array(coins.length).fill(null));
    }

    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'error' }, { status: 500 });
  }
}
