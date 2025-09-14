"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { subscribe, getState } from "@/lib/pollerClient";
import { getMuted, subscribeMet } from "@/lib/metronome";

export default function TimerBar() {
  const [startAt] = useState<number>(() => Date.now());
  const [chronoNow, setChronoNow] = useState<number>(() => Date.now());

  const [rem40, setRem40] = useState<number>(() => getState().remaining40);
  const [rem120, setRem120] = useState<number>(() => getState().remaining120);
  const [phase, setPhase] = useState<number>(() => getState().phase);
  const [cycles, setCycles] = useState<number>(() => getState().cyclesCompleted);

  const audioCtxRef = useRef<AudioContext|null>(null);
  const mutedRef = useRef<boolean>(getMuted());

  useEffect(() => {
    const unsubMet = subscribeMet(ev => { if (ev.type === "metronome") mutedRef.current = ev.muted; });

    const unsub = subscribe((ev) => {
      if (ev.type === "state") {
        setRem40(ev.state.remaining40);
        setRem120(ev.state.remaining120);
        setPhase(ev.state.phase);
        setCycles(ev.state.cyclesCompleted);
      } else if (ev.type === "tick40") {
        if (mutedRef.current) return;
        try {
          if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
          const ctx = audioCtxRef.current!;
          const beep = (f = 880, dur = 0.08, g1 = 0.09) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = "sine"; o.frequency.value = f;
            o.connect(g); g.connect(ctx.destination);
            g.gain.setValueAtTime(0.0001, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(g1, ctx.currentTime + 0.01);
            o.start(); o.stop(ctx.currentTime + dur);
          };
          beep();
          if (ev.isThird) setTimeout(() => beep(980, 0.1, 0.11), 120);
        } catch {}
      }
    });

    const raf = () => { setChronoNow(Date.now()); id = requestAnimationFrame(raf); };
    let id = requestAnimationFrame(raf);
    return () => { unsub(); unsubscribeRAF(); unsubMet(); };
    function unsubscribeRAF(){ cancelAnimationFrame(id); }
  }, []);

  const chrono = useMemo(() => {
    const ms = Math.max(0, chronoNow - startAt);
    const s = Math.floor(ms / 1000) % 60;
    const m = Math.floor(ms / 60000) % 60;
    const h = Math.floor(ms / 3600000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const nCycles = Math.floor(ms / 40000);
    return { label: `${pad(h)}:${pad(m)}::${pad(s)} (${nCycles})` };
  }, [chronoNow, startAt]);

  return (
    <div className="w-full flex items-center justify-between mb-4">
      <div className="text-sm text-slate-300">
        Chronometer: <span className="font-mono tracking-tight">{chrono.label}</span>
      </div>
      <div className="text-sm text-slate-300">
        Metronome: <span className="font-mono tracking-tight">120s:{rem120}s • 40s:{rem40}s ({phase}/3)</span>
      </div>
    </div>
  );
}
