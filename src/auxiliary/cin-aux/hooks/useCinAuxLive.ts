'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Options = {
  appSessionId?: string;             // default 'dev-session'
  getCycleTs: () => number;          // sync, required
  pollMs?: number;                   // optional re-fetch interval (default 40000)
};

type Row = {
  app_session_id: string; cycle_ts: number; symbol: string;
  wallet_usdt: number; profit_usdt: number;
  imprint_cycle_usdt: number; luggage_cycle_usdt: number;
  imprint_app_session_usdt: number; luggage_app_session_usdt: number;
};

export function useCinAuxLive(opts: Options) {
  const appSessionId = opts.appSessionId ?? 'dev-session';
  const pollMs = Number.isFinite(opts.pollMs) ? Number(opts.pollMs) : 40000;
  const getCycleTs = opts.getCycleTs;

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const cycleTsRef = useRef<number>(0);
  const url = useMemo(() => {
    const ts = Number(getCycleTs());
    cycleTsRef.current = Number.isFinite(ts) && ts > 0 ? ts : Date.now();
    const params = new URLSearchParams({
      appSessionId,
      cycleTs: String(cycleTsRef.current),
    });
    return `/api/cin-aux/rows?${params.toString()}`;
  }, [appSessionId, getCycleTs]); // recompute whenever the getter identity changes

  useEffect(() => {
    let mounted = true;
    let timer: any;

    async function fetchOnce() {
      try {
        setLoading(true);
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        const j = await r.json();
        if (mounted) {
          setRows(Array.isArray(j.rows) ? j.rows : []);
          setError(null);
        }
      } catch (e: any) {
        if (mounted) setError(new Error(e?.message || 'fetch failed'));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchOnce();
    timer = setInterval(fetchOnce, pollMs);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [url, pollMs]);

  return { rows, loading, error, cycleTs: cycleTsRef.current };
}
