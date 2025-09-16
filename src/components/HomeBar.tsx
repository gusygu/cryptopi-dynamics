// src/components/HomeBar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { getState, setEnabled, requestRefresh, subscribe, type PollerEvent } from "@/lib/pollerClient";
import { getMuted, setMuted, subscribeMet } from "@/lib/metronome";

type DbStatus = "on" | "off" | "-";

let DB_HEALTH_DISABLED = false;
let DB_HEALTH_LAST_AT = 0;
async function fetchDbHealth(): Promise<DbStatus> {
  if (DB_HEALTH_DISABLED) return "-";
  const now = Date.now();
  if (now - DB_HEALTH_LAST_AT < 10_000) return "-";
  DB_HEALTH_LAST_AT = now;
  try {
    const r = await fetch("/api/db/health", { cache: "no-store" });
    if (!r.ok) {
      if (r.status === 404) DB_HEALTH_DISABLED = true;
      return "-";
    }
    const j = await r.json();
    const s = String(j?.status || j?.state || "").toLowerCase();
    if (s === "on" || s === "ok" || s === "healthy") return "on";
    if (s === "off" || s === "disabled") return "off";
    return "-";
  } catch {
    return "-";
  }
}

function Pill({ label, tone }: { label: string; tone: "emerald" | "rose" | "zinc" }) {
  const map = {
    emerald: "bg-emerald-600/20 text-emerald-200 border-emerald-500/30",
    rose: "bg-rose-600/20 text-rose-200 border-rose-500/30",
    zinc: "bg-zinc-700/30 text-zinc-200 border-zinc-500/30",
  } as const;
  return <span className={`px-2 py-[3px] rounded-md text-[11px] font-mono border ${map[tone]}`}>{label}</span>;
}

export function HomeBarShell({
  children,
  asideClassName = "w-[320px] border-l border-zinc-700/30 bg-zinc-900/40 backdrop-blur-md",
  contentClassName = "flex-1 min-w-0",
}: {
  children: ReactNode;
  asideClassName?: string;
  contentClassName?: string;
}) {
  const [showClocks, setShowClocks] = useState(false);
  return (
    <div className="flex min-h-dvh">
      <main className={contentClassName}>{children}</main>
      <HomeBar className={asideClassName} onToggleClocks={() => setShowClocks((v) => !v)} />
      {showClocks ? (
        <div className="fixed bottom-3 right-[340px] rounded-xl border border-zinc-700/40 bg-zinc-900/80 px-3 py-2 text-xs text-zinc-200">
          chronometer & metronome visible
        </div>
      ) : null}
    </div>
  );
}

export default function HomeBar({
  onToggleClocks,
  className = "",
}: {
  onToggleClocks?: () => void;
  className?: string;
}) {
  const pathname = usePathname() || "/";

  const [autoOn, setAutoOn]   = useState<boolean>(() => getState().enabled);
  const [metMute, setMetMute] = useState<boolean>(() => getMuted());
  const [db, setDb]           = useState<DbStatus>("-");
  const [rem40, setRem40]     = useState<number>(() => getState().remaining40);
  const [rem120, setRem120]   = useState<number>(() => getState().remaining120);
  const [phase, setPhase]     = useState<number>(() => getState().phase);
  const [isLeader, setIsLeader] = useState<boolean>(() => getState().isLeader);
  const [dur40, setDur40]     = useState<number>(() => getState().dur40);
  const [dur120, setDur120]   = useState<number>(() => getState().dur120);

  const metMuteRef = useRef(metMute);
  useEffect(() => { metMuteRef.current = metMute; }, [metMute]);

  useEffect(() => {
    const onEv = (ev: PollerEvent) => {
      if (ev.type === "state") {
        setAutoOn(ev.state.enabled);
        setRem40(ev.state.remaining40);
        setRem120(ev.state.remaining120);
        setPhase(ev.state.phase);
        setIsLeader(ev.state.isLeader);
        setDur40(ev.state.dur40);
        setDur120(ev.state.dur120);
      } else if (ev.type === "tick") {
        setRem40(ev.remaining40);
        setRem120(ev.remaining120);
        setPhase(ev.phase);
      } else if (ev.type === "tick40" || ev.type === "refresh") {
        fetchDbHealth().then(setDb);
      }
    };
    const unsub = subscribe(onEv);
    fetchDbHealth().then(setDb);
    return () => { unsub(); };
  }, []);

  useEffect(() => {
    const s = getState();
    if (s?.remaining40 != null) setRem40(s.remaining40);
    if (s?.remaining120 != null) setRem120(s.remaining120);
    const unsub = subscribe((ev) => {
      if (ev.type === "tick") {
        setRem40(ev.remaining40);
        setRem120(ev.remaining120);
      } else if (ev.type === "state") {
        setRem40(ev.state.remaining40);
        setRem120(ev.state.remaining120);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeMet((e) => { if (e.type === "metronome") setMetMute(e.muted); });
    setMetMute(getMuted());
    return () => { unsub(); };
  }, []);

  // WIDENED TYPE: avoid literal-union narrowing that produced the “no overlap with '/'” error
  const items: { href: string; label: string }[] = useMemo(
    () => ([
      { href: "/dynamics", label: "Dashboard" },
      { href: "/matrices", label: "Matrices" },
      { href: "/str-aux", label: "Str-aux" },
      { href: "/settings", label: "Settings" },
      { href: "/intro",    label: "Intro" },
    ]),
    []
  );

  const onToggleAuto = useCallback(() => setEnabled(!autoOn), [autoOn]);
  const onRefresh = useCallback(() => requestRefresh(), []);
  const onToggleMetronome = useCallback(() => setMuted(!metMute), [metMute]);

  return (
    <aside className={`w-full ${className}`}>
      <div className="px-3 py-2 flex items-center gap-2">
        <nav aria-label="Primary" className="flex items-center">
          <ul className="flex flex-wrap items-center gap-2 list-none m-0 p-0">
            {items.map((it) => {
              const active = pathname === it.href || pathname.startsWith(it.href);
              const cls = active
                ? "bg-emerald-600/25 text-emerald-100 border-emerald-500/30"
                : "bg-zinc-800/40 text-zinc-100 border-zinc-600/40 hover:bg-zinc-700/50";
              return (
                <li key={it.href}>
                  <Link href={it.href} className={`px-3 py-1.5 text-xs rounded-md border transition ${cls}`}>
                    {it.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex items-center gap-2 ml-2">
          <button
            type="button"
            aria-pressed={autoOn}
            onClick={onToggleAuto}
            className={`rounded-md px-3 py-1.5 text-xs border transition ${
              autoOn
                ? "bg-emerald-700/70 text-emerald-50 border-emerald-500/40 hover:bg-emerald-600/80"
                : "bg-zinc-800/70 text-zinc-100 border-zinc-600/40 hover:bg-zinc-700/80"
            }`}
            title="Toggle auto polling"
          >
            Auto: {autoOn ? "ON" : "OFF"}
          </button>

          <button
            type="button"
            onClick={onRefresh}
            className="rounded-md px-3 py-1.5 text-xs border bg-indigo-600/80 text-indigo-50 border-indigo-500/40 hover:bg-indigo-500/90"
            title="Manual refresh"
          >
            Refresh
          </button>

          <button
            type="button"
            onClick={onToggleClocks}
            className="rounded-md px-3 py-1.5 text-xs border bg-zinc-800/70 text-zinc-100 border-zinc-600/40 hover:bg-zinc-700/80"
            title="Show/Hide chronometer & metronome"
          >
            Clocks
          </button>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 text-[11px]">
            <span className="text-zinc-400">Phase</span>
            <code className="px-1 rounded border border-zinc-600/40 bg-zinc-800/60">{phase}</code>
            <span className="text-zinc-400 ml-2">40s</span>
            <code className="px-1 rounded border border-zinc-600/40 bg-zinc-800/60 tabular-nums w-10 text-right" suppressHydrationWarning>
              {rem40}
            </code>
            <span className="text-zinc-400 ml-2">120s</span>
            <code className="px-1 rounded border border-zinc-600/40 bg-zinc-800/60 tabular-nums w-12 text-right" suppressHydrationWarning>
              {rem120}
            </code>
          </div>
          <Pill label={`auto:${autoOn ? "ON" : "OFF"}`} tone={autoOn ? "emerald" : "zinc"} />
          <Pill label={`db:${db === "-" ? "-" : db.toUpperCase()}`} tone={db === "on" ? "emerald" : db === "off" ? "rose" : "zinc"} />
          <Pill label={`P:${isLeader ? "L" : "F"} ${dur40}/${dur120}`} tone={isLeader ? "emerald" : "zinc"} />
        </div>
      </div>
    </aside>
  );
}
