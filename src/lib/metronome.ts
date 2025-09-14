// src/lib/metronome.ts
"use client";

export type MetEvent = { type: "metronome"; muted: boolean };

const LS_KEY = "cryptopi:metronome:muted";
const BC_NAME = "cryptopi-metronome";

type Sub = (e: MetEvent) => void;

class MetronomeState {
  private bc?: BroadcastChannel;
  private subs = new Set<Sub>();
  private _muted = false;

  constructor() {
    if (typeof window !== "undefined") {
      try { this._muted = localStorage.getItem(LS_KEY) === "1"; } catch {}
      this.bc = new BroadcastChannel(BC_NAME);
      this.bc.onmessage = (e) => this.emit(e.data as MetEvent);
      window.addEventListener("storage", (ev) => {
        if (ev.key === LS_KEY) this.setMuted(ev.newValue === "1", false);
      });
    }
  }

  isMuted() { return this._muted; }

  setMuted(muted: boolean, broadcast = true) {
    this._muted = !!muted;
    try { localStorage.setItem(LS_KEY, this._muted ? "1" : "0"); } catch {}
    const ev: MetEvent = { type: "metronome", muted: this._muted };
    if (broadcast) this.bc?.postMessage(ev);
    this.emit(ev);
  }

  subscribe(fn: Sub) {
    this.subs.add(fn);
    fn({ type: "metronome", muted: this._muted });
    return () => { this.subs.delete(fn); };
  }

  private emit(ev: MetEvent) { this.subs.forEach(fn => { try { fn(ev); } catch {} }); }
}

let singleton: MetronomeState | null = null;
function get() { if (!singleton) singleton = new MetronomeState(); return singleton; }

export const getMuted = () => get().isMuted();
export const setMuted = (m: boolean) => get().setMuted(m);
export const subscribeMet = (fn: Sub) => get().subscribe(fn);
