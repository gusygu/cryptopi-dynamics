// src/auxiliary/cin-aux/ui/CinAuxTable.tsx
'use client';

import * as React from 'react';
import { useCinAuxLive } from '@/auxiliary/cin-aux/hooks/useCinAuxLive';

type Row = {
  app_session_id: string;
  cycle_ts: number;
  symbol: string;
  wallet_usdt: number;
  profit_usdt: number;
  imprint_cycle_usdt: number;
  luggage_cycle_usdt: number;
  imprint_app_session_usdt: number;
  luggage_app_session_usdt: number;
};

type Props = {
  appSessionId?: string;
  getCycleTs?: () => number;         // sync default below keeps hook happy
  className?: string;
};

const fmt = (n: number | null | undefined) =>
  typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—';

export default function CinAuxTable({
  appSessionId = 'dev-session',
  getCycleTs = () => Date.now(),
  className = '',
}: Props) {
  const getCycleTsSync = React.useCallback((): number => {
    try {
      const v = Number(getCycleTs());
      return Number.isFinite(v) && v > 0 ? v : Date.now();
    } catch {
      return Date.now();
    }
  }, [getCycleTs]);

  const { rows, loading, error } = useCinAuxLive({
    appSessionId,
    getCycleTs: getCycleTsSync,
  }) as { rows: Row[]; loading: boolean; error?: Error | null };

  return (
    <div className={`rounded-2xl bg-slate-900/60 p-3 text-[12px] text-slate-200 border border-slate-700/30 ${className}`}>
      {error && <div className="text-red-400 text-sm mb-3">cin_aux error: {String(error.message || error)}</div>}

      <div className="overflow-x-auto rounded-xl border border-slate-800/60 bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-800/60 text-slate-300">
            <tr>
              <Th>Symbol</Th>
              <Th className="text-right">Wallet (USDT)</Th>
              <Th className="text-right">Profit (USDT)</Th>
              <Th className="text-right">Imprint (cycle)</Th>
              <Th className="text-right">Luggage (cycle)</Th>
              <Th className="text-right">Imprint (session)</Th>
              <Th className="text-right">Luggage (session)</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-slate-400">loading…</td>
              </tr>
            )}

            {!loading && rows?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-slate-500">no CIN rows for this cycle/session yet</td>
              </tr>
            )}

            {!loading && rows?.map((r) => (
              <tr key={`${r.app_session_id}-${r.cycle_ts}-${r.symbol}`} className="hover:bg-slate-800/30">
                <Td className="font-medium text-slate-200">{r.symbol}</Td>
                <TdRight className="font-mono tabular-nums tracking-tight">{fmt(r.wallet_usdt)}</TdRight>
                <TdRight className={`font-mono tabular-nums tracking-tight ${posNeg(r.profit_usdt)}`}>{fmt(r.profit_usdt)}</TdRight>
                <TdRight className={`font-mono tabular-nums tracking-tight ${posNeg(r.imprint_cycle_usdt)}`}>{fmt(r.imprint_cycle_usdt)}</TdRight>
                <TdRight className={`font-mono tabular-nums tracking-tight ${posNeg(r.luggage_cycle_usdt)}`}>{fmt(r.luggage_cycle_usdt)}</TdRight>
                <TdRight className={`font-mono tabular-nums tracking-tight ${posNeg(r.imprint_app_session_usdt)}`}>{fmt(r.imprint_app_session_usdt)}</TdRight>
                <TdRight className={`font-mono tabular-nums tracking-tight ${posNeg(r.luggage_app_session_usdt)}`}>{fmt(r.luggage_app_session_usdt)}</TdRight>

              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function posNeg(n: number) {
  if (!Number.isFinite(n)) return '';
  if (n > 0) return 'text-emerald-400';
  if (n < 0) return 'text-rose-400';
  return 'text-slate-300';
}
function Th({ children, className = '' }: React.PropsWithChildren<{ className?: string }>) {
  return <th className={`px-4 py-3 font-semibold text-left ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: React.PropsWithChildren<{ className?: string }>) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}
function TdRight({ children, className = '' }: React.PropsWithChildren<{ className?: string }>) {
  return <Td className={`text-right tabular-nums ${className}`}>{children}</Td>;
}
