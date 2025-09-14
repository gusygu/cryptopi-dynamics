"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

// Poller (auto/refresh/state)
import { getState, setEnabled, requestRefresh, subscribe } from "@/lib/pollerClient";
// Metronome (global mute sync)
import { getMuted, setMuted, subscribeMet } from "@/lib/metronome";

/* ------------------------------- types ------------------------------- */

type DbStatus = "on" | "off" | "-";

/* ----------------------------- utilities ----------------------------- */

async function fetchDbHealth(): Promise<DbStatus> {
  try {
    const r = await fetch("/api/db/health", { cache: "no-store" });
    if (!r.ok) return "-";
    const j = await r.json();
    const s = String(j?.status || j?.state || "").toLowerCase();
    if (s === "on" || s === "ok" || s === "healthy") return "on";
    if (s === "off" || s === "disabled") return "off";
    return "-";
  } catch {
    return "-";
  }
}

function pill(label: string, tone: "emerald" | "rose" | "zinc") {
  const map = {
    emerald: "bg-emerald-600/20 text-emerald-200 border-emerald-500/30",
    rose:    "bg-rose-600/20 text-rose-200 border-rose-500/30",
    zinc:    "bg-zinc-700/30 text-zinc-200 border-zinc-500/30",
  } as const;
  return (
    <span
      className={`px-2 py-[3px] rounded-md text-[11px] font-mono border ${map[tone]}`}
    >
      {label}
    </span>
  );
}

/* ------------------------------- component ------------------------------- */

export default function HomeBar({
  onToggleClocks,
  className = "",
}: {
  onToggleClocks?: () => void;
  className?: string;
}) {
  const pathname = usePathname() || "/";

  // buttons state
  const [autoOn, setAutoOn] = useState<boolean>(() => getState().enabled);
  const [metMute, setMetMute] = useState<boolean>(() => getMuted());
  const [db, setDb] = useState<DbStatus>("-");

  // sync poller state + ping DB health on activity
  useEffect(() => {
    const unsub = subscribe((ev) => {
      if (ev.type === "state") setAutoOn(ev.state.enabled);
      if (ev.type === "tick40" || ev.type === "refresh") fetchDbHealth().then(setDb);
    });
    // initial fetch
    fetchDbHealth().then(setDb);
    return () => unsub();
  }, []);

  // metronome global mute sync (BroadcastChannel + storage)
  useEffect(() => {
    const unsub = subscribeMet((e) => { if (e.type === "metronome") setMetMute(e.muted); });
    // ensure local view matches persisted value on mount
    setMetMute(getMuted());
    return () => { unsub(); };
  }, []);

  // nav items
  const items = useMemo(
    () => ([
      { href: "/",          label: "Dashboard" },
      { href: "/dynamics",  label: "Matrices"  },
      { href: "/straux",    label: "Str-aux"   },
      { href: "/settings",  label: "Settings"  },
      { href: "/intro",     label: "Intro"     },
    ]),
    []
  );

  return (
    <div className={`w-full ${className}`} >
     <div className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
          {items.map((it) => {
            const active = pathname === it.href || (it.href !== "/" && pathname.startsWith(it.href));
            const cls = active
              ? "bg-emerald-600/25 text-emerald-100 border-emerald-500/30"
              : "bg-zinc-800/40 text-zinc-100 border-zinc-600/40 hover:bg-zinc-700/50";
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  className={`px-3 py-1.5 text-xs rounded-md border transition ${cls}`}
                >
                  {it.label}
                </Link>
              </li>
            );
          })}
        </div>

        {/* CONTROLS (center) */}
        <div className="flex items-center gap-2 ml-2">
          {/* Auto toggle */}
          <button
            type="button"
            aria-pressed={autoOn}
            onClick={() => setEnabled(!autoOn)}
            className={`rounded-md px-3 py-1.5 text-xs border transition ${
              autoOn
                ? "bg-emerald-700/70 text-emerald-50 border-emerald-500/40 hover:bg-emerald-600/80"
                : "bg-zinc-800/70 text-zinc-100 border-zinc-600/40 hover:bg-zinc-700/80"
            }`}
            title="Toggle auto polling"
          >
            Auto: {autoOn ? "ON" : "OFF"}
          </button>

          {/* Refresh now */}
          <button
            type="button"
            onClick={() => requestRefresh()}
            className="rounded-md px-3 py-1.5 text-xs border bg-indigo-600/80 text-indigo-50 border-indigo-500/40 hover:bg-indigo-500/90"
            title="Manual refresh"
          >
            Refresh
          </button>

          {/* Clocks toggle */}
          <button
            type="button"
            onClick={() => onToggleClocks?.()}
            className="rounded-md px-3 py-1.5 text-xs border bg-zinc-800/70 text-zinc-100 border-zinc-600/40 hover:bg-zinc-700/80"
            title="Show/Hide chronometer & metronome"
          >
            Clocks
          </button>

          {/* Metronome mute (global) */}
          <button
            type="button"
            aria-pressed={!metMute}
            onClick={() => setMuted(!metMute)}
            className={`rounded-md px-3 py-1.5 text-xs border transition ${
              metMute
                ? "bg-zinc-800/70 text-zinc-100 border-zinc-600/40 hover:bg-zinc-700/80"
                : "bg-emerald-700/70 text-emerald-50 border-emerald-500/40 hover:bg-emerald-600/80"
            }`}
            title={metMute ? "Unmute metronome" : "Mute metronome"}
          >
            Metronome: {metMute ? "OFF" : "ON"}
          </button>
        </div>

        {/* STATUS (right) */}
        <div className="ml-auto flex items-center gap-2">
          {pill(`auto:${autoOn ? "ON" : "OFF"}`, autoOn ? "emerald" : "zinc")}
          {pill(`db:${db === "-" ? "—" : db.toUpperCase()}`, db === "on" ? "emerald" : db === "off" ? "rose" : "zinc")}
        </div>
      </div>
    </div>
  );
}
