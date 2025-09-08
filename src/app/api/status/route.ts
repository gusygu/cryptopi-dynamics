// src/app/api/status/route.ts
import { NextResponse } from 'next/server';
import { summarizeReport, type Report, type ReportItem } from '@/lib/types';

export async function GET() {
  const now = Date.now();
  const coins = (process.env.COINS ?? 'BTC,ETH,BNB,ADA,SOL,USDT')
    .split(',').map(s => s.trim()).filter(Boolean);

  // minimal read until sampler is hooked
  const pollerState = process.env.EMBED_POLLER === '1' ? 'running' : 'stopped';

  const items: ReportItem[] = [
    { key: 'feed:binance',  label: 'Binance feed',   level: 'ok',  value: true,      ts: now },
    { key: 'tickset:size',  label: 'Tickers loaded', level: coins.length ? 'ok' : 'warn', value: coins.length, ts: now },
    { key: 'poller:state',  label: 'Poller',         level: pollerState === 'running' ? 'ok' : 'warn', value: pollerState, ts: now },
    { key: 'latest:ts',     label: 'Latest tick ts', level: 'ok',  value: now - 60_000, ts: now },
  ];

  const report: Report = { id: 'status:'+now, scope: 'aux', items, summary: summarizeReport(items), ts: now };
  return NextResponse.json(report);
}
