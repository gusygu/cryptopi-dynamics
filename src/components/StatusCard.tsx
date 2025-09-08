"use client";
import { useEffect, useState } from "react";

type Status = {
  ok: boolean;
  mode?: string;
  coins?: string[];
  poller?: { running: boolean; intervalMs: number; embedded?: boolean };
  latestTs?: Record<string, number | null>;
  counts?: Record<string, number>;
  error?: string;
};

const tsPill = (ts: number|null|undefined) => {
  if (!ts || !Number.isFinite(ts)) return "—";
  const d = new Date(Number(ts));
  return isNaN(d.getTime()) ? "—" : d.toLocaleTimeString();
};

export default function StatusCard() {
  const [s, setS] = useState<Status | null>(null);

  async function refresh() {
    try {
      const r = await fetch("/api/status", { cache: "no-store" });
      setS(await r.json());
    } catch (e) {
      setS({ ok: false, error: String(e) });
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  if (!s) return null;

  const coins = s.coins ?? [];
  const lt = s.latestTs ?? {};
  const cnt = s.counts ?? {};

  return (
    <div className="mb-3 rounded-2xl bg-slate-800/60 p-3 text-[12px] text-slate-200 border border-slate-700/30">
      <div className="flex items-center justify-between">
        <div>Mode: <b>{s.mode ?? "—"}</b> • Coins: {coins.length ? coins.join(", ") : "—"}</div>
        <div>Poller: {s.poller?.running ? "running" : "stopped"} ({s.poller?.intervalMs ?? 0} ms)</div>
      </div>
      <div className="mt-2 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        {Object.entries(lt).map(([k, ts]) => (
          <div key={k} className="rounded bg-slate-900/50 px-2 py-1 border border-slate-700/30">
            <div className="text-slate-400">{k}</div>
            <div className="font-mono tracking-tight">{tsPill(ts)} • {cnt[k] ?? 0} rows</div>
          </div>
        ))}
      </div>
      {s.error ? <div className="mt-2 text-red-300">error: {s.error}</div> : null}
    </div>
  );
}
