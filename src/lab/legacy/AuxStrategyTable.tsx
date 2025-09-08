"use client";

import { useEffect, useMemo, useState } from "react";
import { formatPct, formatTs } from "./format";

type Doc = {
  id: string;
  pair: { base: string; quote: string; window: string; appSessionId?: string };
  opening: any;
  nuclei: any;
  stats: Record<string, any>;
  stream: any;
  updatedAt: number;
};

type Props = {
  base?: string;
  quote?: string;
  windowKey?: "30m" | "1h" | "3h";
  session?: string;
  refreshMs?: number;
  className?: string;
};

export default function AuxStrategyTable({
  base = "BTC",
  quote = "USDT",
  windowKey = "30m",
  session = "dev-session",
  refreshMs = 5000,
  className = "",
}: Props) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const qs = useMemo(
    () =>
      new URLSearchParams({
        base,
        quote,
        window: windowKey,
        session,
      }).toString(),
    [base, quote, windowKey, session]
  );

  async function fetchLatest() {
    try {
      setErr(null);
      const res = await fetch(`/api/aux-strategy/latest?${qs}`, { cache: "no-store" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const j = await res.json();
      setDoc(j.doc as Doc);
    } catch (e: any) {
      setErr(e?.message ?? "fetch_error");
    }
  }

  useEffect(() => {
    fetchLatest();
    const t = setInterval(fetchLatest, refreshMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs, refreshMs]);

  return (
    
    <div className={`w-full max-w-4xl rounded-2xl shadow p-4 border ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-lg font-semibold">
          aux-strategy · {base}/{quote} · {windowKey}
        </div>
        <div className="text-xs opacity-70">
          {doc ? `updated: ${new Date(doc.updatedAt).toLocaleTimeString()}` : "—"}
        </div>
      </div>

      {err && (
        <div className="text-sm text-red-500 mb-2">error: {err}</div>
      )}

      {!doc ? (
        <div className="text-sm opacity-70">loading…</div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left border-b">
              <tr>
                <th className="py-2 pr-3">Metric</th>
                <th className="py-2">Value</th>
              </tr>
            </thead>
            <tbody className="align-top">
              <tr className="border-b">
                <td className="py-2 pr-3 font-medium">id</td>
                <td className="py-2 font-mono">{doc.id}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-3 font-medium">opening.benchmark</td>
                <td className="py-2">{String(doc.opening?.benchmark ?? "—")}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-3 font-medium">opening.pct24h</td>
                <td className="py-2">{String(doc.opening?.pct24h ?? "—")}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-3 font-medium">stats.keys</td>
                <td className="py-2">{Object.keys(doc.stats || {}).join(", ") || "—"}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-3 font-medium">nuclei.len</td>
                <td className="py-2">{Array.isArray(doc.nuclei) ? doc.nuclei.length : "—"}</td>
              </tr>
              <tr>
                <td className="py-2 pr-3 font-medium">stream.len</td>
                <td className="py-2">
                  {Array.isArray(doc.stream) ? doc.stream.length : (doc.stream ? "1" : "—")}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
