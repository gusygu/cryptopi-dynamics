// src/components/HomeBar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  getState,
  setEnabled,
  requestRefresh,
  subscribe,
  type PollerEvent,
} from "@/lib/pollerClient";

/* ─────────────────────────── helpers ─────────────────────────── */

type DbStatus = "on" | "off" | "-";
type ServerPoller = { running: boolean | null; ms: number | null; busy: boolean };

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
    const j: any = await r.json();
    // accept { ok: true } OR { status/state: "on" }
    if (typeof j?.ok === "boolean") return j.ok ? "on" : "off";
    const s = String(j?.status || j?.state || "").toLowerCase();
    if (s === "on" || s === "ok" || s === "healthy") return "on";
    if (s === "off" || s === "disabled") return "off";
    return "-";
  } catch {
    return "-";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Server poller hook backed by /api/pipeline/auto */
function useServerPoller(): {
  state: ServerPoller;
  refresh: () => Promise<void>;
  start: (opts?: { immediate?: boolean }) => Promise<void>;
  stop: () => Promise<void>;
  runOnce: () => Promise<void>;
} {
  const [running, setRunning] = useState<boolean | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/pipeline/auto", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j: any = await r.json();
      const m = Number(j?.state?.intervalMs ?? j?.intervalMs);
      setRunning(
        typeof j?.state?.running === "boolean"
          ? j.state.running
          : typeof j?.running === "boolean"
          ? j.running
          : null
      );
      setMs(Number.isFinite(m) ? Math.round(m) : null);
    } catch {
      setRunning(null);
      setMs(null);
    }
  }, []);

  const start = useCallback(
    async (opts?: { immediate?: boolean }) => {
      setBusy(true);
      try {
        const u = new URL("/api/pipeline/auto", location.origin);
        if (opts?.immediate) u.searchParams.set("immediate", "1");
        const r = await fetch(u, { method: "POST" });
        if (!r.ok) throw new Error(String(r.status));
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/pipeline/auto", { method: "DELETE" });
      if (!r.ok) throw new Error(String(r.status));
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const runOnce = useCallback(async () => {
    setBusy(true);
    try {
      // If already running, kick an immediate cycle; otherwise do a one-shot POST with immediate=1
      const r = await fetch("/api/pipeline/auto?immediate=1", { method: "POST" });
      if (!r.ok) throw new Error(String(r.status));
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  return { state: { running, ms, busy }, refresh, start, stop, runOnce };
}

function Pill({ label, tone }: { label: string; tone: "emerald" | "rose" | "zinc" }) {
  const map = {
    emerald: "bg-emerald-600/20 text-emerald-200 border-emerald-500/30",
    rose: "bg-rose-600/20 text-rose-200 border-rose-500/30",
    zinc: "bg-zinc-700/30 text-zinc-200 border-zinc-500/30",
  } as const;
  return (
    <span className={`px-2 py-[3px] rounded-md text-[11px] font-mono border ${map[tone]}`}>
      {label}
    </span>
  );
}

/* ─────────────────────────── exported shells ─────────────────────────── */

export function HomeBarShell({
  children,
  asideClassName = "w-[340px] border-l border-zinc-700/30 bg-zinc-900/40 backdrop-blur-md",
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
        <div className="fixed bottom-3 right-[360px] rounded-xl border border-zinc-700/40 bg-zinc-900/80 px-3 py-2 text-xs text-zinc-200">
          chronometer & metronome visible
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────── main component ─────────────────────────── */

export default function HomeBar({
  onToggleClocks,
  className = "",
}: {
  onToggleClocks?: () => void;
  className?: string;
}) {
  const pathname = usePathname() || "/";

  // client metronome/poller state
  const [autoOn, setAutoOn]   = useState<boolean>(false);
const [rem40, setRem40]     = useState<number>(0);
const [rem120, setRem120]   = useState<number>(0);
const [phase, setPhase]     = useState<number>(0);
const [isLeader, setIsLeader] = useState<boolean>(false);
const [dur40, setDur40]     = useState<number>(40);
const [dur120, setDur120]   = useState<number>(120);

  // server poller state
  const { state: sp, start, stop, runOnce } = useServerPoller();

  // db health
  const [db, setDb] = useState<DbStatus>("-");

  // subscribe to client poller ticks
  useEffect(() => {
    void fetchDbHealth().then(setDb);
    const s = getState();                    // <-- sync once after mount
    setAutoOn(s.enabled);
    setRem40(s.remaining40);
    setRem120(s.remaining120);
    setPhase(s.phase);
    setIsLeader(s.isLeader);
    setDur40(s.dur40);
    setDur120(s.dur120);

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
        // refresh DB pill occasionally at boundaries
        void fetchDbHealth().then(setDb);
      }
    };
    const unsub = subscribe(onEv);
   

    

    void fetchDbHealth().then(setDb);
    return () => unsub();
}, []);

  // small protection: when turning Auto ON, nudge a manual refresh once
  const toggling = useRef(false);
  const onToggleAuto = useCallback(async () => {
    toggling.current = true;
    setEnabled(!autoOn);
    if (!autoOn) {
      await sleep(150);
      requestRefresh();
    }
    toggling.current = false;
  }, [autoOn]);

  const onRefresh = useCallback(() => requestRefresh(), []);

  const items = useMemo(
    () => [
      { href: "/dynamics", label: "Dashboard" },
      { href: "/matrices", label: "Matrices" },
      { href: "/str-aux", label: "Str-aux" },
      { href: "/settings", label: "Settings" },
      { href: "/intro", label: "Intro" },
    ],
    []
  );

  return (
    <aside className={`w-full ${className}`}>
      <div className="px-3 py-2 flex items-center gap-2">
        {/* nav */}
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

        {/* client poller controls */}
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
            title="Toggle UI auto refresh (client metronome)"
          >
            Auto: {autoOn ? "ON" : "OFF"}
          </button>

          <button
            type="button"
            onClick={onRefresh}
            className="rounded-md px-3 py-1.5 text-xs border bg-indigo-600/80 text-indigo-50 border-indigo-500/40 hover:bg-indigo-500/90"
            title="Manual refresh of UI data"
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


        {/* server poller controls */}
        <div className="flex items-center gap-2 ml-3">
          <button
            type="button"
            disabled={sp.busy}
            onClick={() => start({ immediate: true })}
            className="rounded-md px-3 py-1.5 text-xs border bg-emerald-600/90 text-emerald-50 border-emerald-500/40 hover:brightness-95 disabled:opacity-60"
            title="Start server poller (and run one cycle now)"
          >
            {sp.busy ? "…" : "Poller ▶"}
          </button>
          <button
            type="button"
            disabled={sp.busy}
            onClick={stop}
            className="rounded-md px-3 py-1.5 text-xs border bg-rose-600/90 text-rose-50 border-rose-500/40 hover:brightness-95 disabled:opacity-60"
            title="Stop server poller"
          >
            {sp.busy ? "…" : "Poller ■"}
          </button>
          <button
            type="button"
            disabled={sp.busy}
            onClick={runOnce}
            className="rounded-md px-3 py-1.5 text-xs border bg-amber-600/90 text-amber-50 border-amber-500/40 hover:brightness-95 disabled:opacity-60"
            title="Run one server cycle now"
          >
            {sp.busy ? "…" : "Run once"}
          </button>
        </div>

        {/* right side status */}
        <div className="ml-auto flex items-center gap-3">
          {/* phase + counters (chronometer) */}
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

          {/* pills */}
          <Pill label={`UI:${isLeader ? "L" : "F"} ${dur40}/${dur120}`} tone={isLeader ? "emerald" : "zinc"} />
          <Pill
            label={`DB:${db === "-" ? "-" : db.toUpperCase()}`}
            tone={db === "on" ? "emerald" : db === "off" ? "rose" : "zinc"}
          />
          <Pill
            label={`SV:${sp.running === null ? "-" : sp.running ? "ON" : "OFF"}${sp.ms ? ` ${sp.ms}ms` : ""}`}
            tone={sp.running ? "emerald" : "zinc"}
          />
        </div>
      </div>
    </aside>
  );
}
