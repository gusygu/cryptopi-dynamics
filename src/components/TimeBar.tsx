"use client";
import { useEffect, useRef, useState } from "react";

export default function TimerBar({ periodMs = 40000 }: { periodMs?: number }) {
  // set start when client mounts to avoid SSR clock drift
  const startRef = useRef<number | null>(null);
  const [remaining, setRemaining] = useState<number>(periodMs);
  const [cycle, setCycle] = useState<number>(1);

  // initialize start time on client
  useEffect(() => {
    if (startRef.current == null) startRef.current = Date.now();
  }, []);

  // metronome/chronometer loop
  useEffect(() => {
    let rafId: number;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = now - last;
      last = now;

      setRemaining((prev) => {
        const next = prev - dt;
        if (next <= 0) {
          const nextCycle = cycle === 3 ? 1 : cycle + 1;
          setCycle(nextCycle);
          // beep: single on cycles 1 & 2; double on wrap to 1
          try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const doBeep = () => {
              const o = ctx.createOscillator();
              const g = ctx.createGain();
              o.type = "sine";
              o.frequency.value = 880;
              o.connect(g);
              g.connect(ctx.destination);
              g.gain.setValueAtTime(0.0001, ctx.currentTime);
              g.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 0.01);
              o.start();
              o.stop(ctx.currentTime + 0.08);
            };
            doBeep();
            if (nextCycle === 1) setTimeout(doBeep, 120);
          } catch {}
          return periodMs;
        }
        return next;
      });

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycle, periodMs]);

  const secLeft = Math.max(0, Math.ceil(remaining / 1000));
  const startAt = startRef.current ?? Date.now();
  const chronoMs = Date.now() - startAt;
  const s = Math.floor(chronoMs / 1000) % 60;
  const m = Math.floor(chronoMs / 60000) % 60;
  const h = Math.floor(chronoMs / 3600000);
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
  <div className="w-full flex items-center justify-between mb-4">
    <div className="text-sm text-slate-300">
      Chronometer:{" "}
      <span className="font-mono tracking-tight">
        {`${pad(h)}H:${pad(m)}M:${pad(s)}S`}
      </span>
    </div>
    <div className="text-sm text-slate-300">
      Metronome:{" "}
      <span className="font-mono tracking-tight">
        ({secLeft}s | {cycle}/3)
      </span>
    </div>
  </div>
);}
