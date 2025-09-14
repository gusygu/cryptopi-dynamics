// src/lib/pollerClient.ts
"use client";

type Phase = 1 | 2 | 3;

export type PollerConfig = {
  cycle40: number;   // seconds, default 40
  cycle120: number;  // seconds, default 120
};

export type PollerState = {
  enabled: boolean;
  isLeader: boolean;
  isFetching: boolean;
  // durations (current config applied)
  dur40: number;
  dur120: number;
  // remaining counters
  remaining40: number;
  remaining120: number;
  phase: Phase;
  cyclesCompleted: number;
  startedAt: number;
  lastOkTs?: number;
  // optional external telemetry
  dbActivity?: number; // 0..100 (UI-friendly index)
};

export type PollerEvent =
  | { type: "state"; state: PollerState }
  | { type: "tick"; sec: number; remaining40: number; remaining120: number; phase: Phase }
  | { type: "tick40"; phase: Phase; isThird: boolean }
  | { type: "tick120" }
  | { type: "refresh" }
  | { type: "config"; config: PollerConfig }
  | { type: "fetch:start" | "fetch:success" | "fetch:error"; ts: number };

type Subscriber = (ev: PollerEvent) => void;
function nowSec() { return Math.floor(Date.now() / 1000); }

const TAB_ID = (() => {
  try { return (Math.random().toString(36).slice(2) + Date.now().toString(36)); } catch { return "tab"; }
})();
const LS_KEY = "cryptopi:poller:leader";
const BC_NAME = "cryptopi-poller";

const FALLBACK_CONFIG: PollerConfig = { cycle40: 40, cycle120: 120 };

class ClientPoller {
  private bc?: BroadcastChannel;
  private subs = new Set<Subscriber>();
  private leader = false;
  private timer?: number;
  private heartbeatTimer?: number;
  private lastSec = nowSec();
  
private lastBroadcastTickSec = 0;

private safeBroadcastTick(ev: Extract<PollerEvent, {type:"tick"}>) {
  const s = ev.sec;
  if (s === this.lastBroadcastTickSec) return; // drop duplicate same-second tick
  this.lastBroadcastTickSec = s;
  this.broadcast(ev);
}
  private config: PollerConfig = { ...FALLBACK_CONFIG };

  private state: PollerState = {
    enabled: true,
    isLeader: false,
    isFetching: false,
    dur40: FALLBACK_CONFIG.cycle40,
    dur120: FALLBACK_CONFIG.cycle120,
    remaining40: FALLBACK_CONFIG.cycle40,
    remaining120: FALLBACK_CONFIG.cycle120,
    phase: 1,
    cyclesCompleted: 0,
    startedAt: Date.now(),
  };

  constructor() {
    if (typeof window !== "undefined") {
      this.bc = new BroadcastChannel(BC_NAME);
      this.bc.onmessage = (e) => this.onMessage(e.data as PollerEvent);
      window.addEventListener("storage", this.onStorage);
      window.addEventListener("beforeunload", () => { if (this.leader) this.releaseLeadership(); });
      this.electLeader();
      // try to fetch config on startup (non-blocking)
      this.loadConfigFromSettings().catch(() => {});
    }
  }

  // ---- Internal helpers -----------------------------------------------------

  private emit(ev: PollerEvent) {
    // Notify local subscribers safely
    for (const fn of this.subs) {
      try { fn(ev); } catch {}
    }
  }

  private broadcast(ev: PollerEvent) {
    // Best-effort cross-tab notification
    try { this.bc?.postMessage(ev); } catch {}
  }

  // ---- Settings / Config ----------------------------------------------------

  private sanitizeConfig(inCfg: any): PollerConfig {
    const c40 = Number(inCfg?.poll?.cycle40 ?? inCfg?.cycle40 ?? FALLBACK_CONFIG.cycle40);
    const c120 = Number(inCfg?.poll?.cycle120 ?? inCfg?.cycle120 ?? FALLBACK_CONFIG.cycle120);
    const valid = (n: number, def: number) => Number.isFinite(n) && n >= 5 && n <= 600 ? Math.floor(n) : def;
    return { cycle40: valid(c40, FALLBACK_CONFIG.cycle40), cycle120: valid(c120, FALLBACK_CONFIG.cycle120) };
  }

  private async loadConfigFromSettings() {
    // Expecting /api/settings?scope=poller -> { poll: { cycle40, cycle120 } }
    try {
      const res = await fetch("/api/settings?scope=poller", { cache: "no-store" });
      if (!res.ok) return;
      const j = await res.json();
      const cfg = this.sanitizeConfig(j);
      this.applyConfigInternal(cfg, /*initial*/ false);
    } catch {
      // ignore, fallback already in place
    }
  }

  private applyConfigInternal(cfg: PollerConfig, initial: boolean) {
    this.config = { ...cfg };
    // adjust durations + clamp remaining so counters don’t exceed new caps
    this.state.dur40 = cfg.cycle40;
    this.state.dur120 = cfg.cycle120;
    if (initial) {
      this.state.remaining40 = cfg.cycle40;
      this.state.remaining120 = cfg.cycle120;
    } else {
      this.state.remaining40 = Math.min(this.state.remaining40, cfg.cycle40);
      this.state.remaining120 = Math.min(this.state.remaining120, cfg.cycle120);
    }
    this.broadcast({ type: "config", config: this.config });
    this.emit({ type: "config", config: this.config });
    this.broadcast({ type: "state", state: this.state });
    this.emit({ type: "state", state: this.state });
  }

  // public API to push settings from Settings page
  applyConfig(cfg: Partial<PollerConfig>) {
    const merged: PollerConfig = {
      cycle40: Math.floor(cfg.cycle40 ?? this.config.cycle40 ?? FALLBACK_CONFIG.cycle40),
      cycle120: Math.floor(cfg.cycle120 ?? this.config.cycle120 ?? FALLBACK_CONFIG.cycle120),
    };
    this.applyConfigInternal(merged, /*initial*/ false);
  }

  getConfig(): PollerConfig { return { ...this.config }; }

  // ---- Leadership -----------------------------------------------------------

  private onStorage = (ev: StorageEvent) => {
    if (ev.key !== LS_KEY) return;
    this.electLeader();
  };

  private readLeader(): { id: string; ts: number } | null {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const j = JSON.parse(raw);
      if (!j || typeof j.ts !== "number" || typeof j.id !== "string") return null;
      return j;
    } catch { return null; }
  }
  private writeLeader() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ id: TAB_ID, ts: Date.now() })); } catch {}
  }
  private releaseLeadership() {
    try { const cur = this.readLeader(); if (cur?.id === TAB_ID) localStorage.removeItem(LS_KEY); } catch {}
  }

  private electLeader() {
    if (typeof window === "undefined") return;
    const cur = this.readLeader();
    const now = Date.now();
    const STALE_MS = 3000;
    if (!cur || (now - cur.ts) > STALE_MS) {
      this.leader = true;
      this.state.isLeader = true;
      this.writeLeader();
      this.startTimers();
      if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = window.setInterval(() => this.writeLeader(), 1000);
    } else {
      if (cur.id !== TAB_ID) {
        this.leader = false;
        this.state.isLeader = false;
        this.stopTimers();
      }
    }
  }

  // ---- Timers ---------------------------------------------------------------

  private startTimers() {
    this.stopTimers();
    this.lastSec = nowSec();
    this.timer = window.setInterval(() => this.tick(), 1000);
  }
  private stopTimers() {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = undefined;
  }

  private tick() {
    const cur = nowSec();
    const dt = Math.max(0, cur - this.lastSec);
    if (dt <= 0) return;
    this.lastSec = cur;

    for (let k = 0; k < dt; k++) {
      this.state.remaining40 -= 1;
      this.state.remaining120 -= 1;

      this.emit({ type: "tick", sec: cur, remaining40: this.state.remaining40, remaining120: this.state.remaining120, phase: this.state.phase });

      if (this.state.remaining40 <= 0) {
        const isThird = this.state.phase === 3 || this.state.remaining120 <= 0;
        this.state.remaining40 = this.state.dur40;
        this.state.phase = (this.state.phase % 3 + 1) as Phase;
        this.state.cyclesCompleted += 1;
        this.broadcast({ type: "tick40", phase: this.state.phase, isThird });
        this.emit({ type: "tick40", phase: this.state.phase, isThird });
      }
      if (this.state.remaining120 <= 0) {
        this.state.remaining120 = this.state.dur120;
        this.broadcast({ type: "tick120" });
        this.emit({ type: "tick120" });
      }
    }
    this.broadcast({ type: "state", state: this.state });
    this.emit({ type: "state", state: this.state });
  }

  // ---- Messaging ------------------------------------------------------------

  private onMessage(ev: PollerEvent) {
    if (ev.type === "state") {
      if (!this.leader) {
        // follow state (but mark as follower)
        const s = ev.state;
        this.state = { ...s, isLeader: false };
        // sync config durations from state (followers rely on leader)
        this.config = { cycle40: s.dur40, cycle120: s.dur120 };
      }
    } else if (ev.type === "config") {
      if (!this.leader) {
        this.applyConfigInternal(ev.config, /*initial*/ false);
      }
    }
    this.emit(ev);
    if (!this.leader) this.electLeader();
  }

  // ---- Public state ops -----------------------------------------------------

  subscribe(fn: Subscriber) {
  this.subs.add(fn);
  fn({ type: "state", state: this.state });
  // return a cleanup that returns void (not boolean)
  return () => { 
    this.subs.delete(fn); 
  };
}
  getState(): PollerState { return this.state; }

  setEnabled(on: boolean) {
    this.state.enabled = on;
    if (this.leader) { if (on) this.startTimers(); else this.stopTimers(); }
    this.broadcast({ type: "state", state: this.state }); this.emit({ type: "state", state: this.state });
  }
  requestRefresh() { this.broadcast({ type: "refresh" }); this.emit({ type: "refresh" }); }
  setFetching(on: boolean) {
    this.state.isFetching = on;
    this.broadcast({ type: on ? "fetch:start" : "fetch:success", ts: Date.now() });
    this.broadcast({ type: "state", state: this.state }); this.emit({ type: "state", state: this.state });
  }
  setLastOkTs(ts: number) { this.state.lastOkTs = ts; this.broadcast({ type: "state", state: this.state }); this.emit({ type: "state", state: this.state }); }

  setDbActivity(idx?: number) {
    if (idx == null || !Number.isFinite(idx)) return;
    const clamped = Math.max(0, Math.min(100, Math.round(idx)));
    this.state.dbActivity = clamped;
    this.broadcast({ type: "state", state: this.state }); this.emit({ type: "state", state: this.state });
  }
}

// HMR-safe singleton across client reloads
declare global {
  // eslint-disable-next-line no-var
  var __CRYPTOPI_POLLER__: ClientPoller | undefined;
}

let singleton: ClientPoller | null = null;
function _get() {
  if (typeof window !== "undefined") {
    if (!window.__CRYPTOPI_POLLER__) window.__CRYPTOPI_POLLER__ = new ClientPoller();
    return window.__CRYPTOPI_POLLER__;
  }
  if (!singleton) singleton = new ClientPoller();
  return singleton;
}

export function getPoller() { return _get(); }
export function subscribe(fn: Subscriber) { return _get().subscribe(fn); }
export function getState() { return _get().getState(); }
export function setEnabled(on: boolean) { return _get().setEnabled(on); }
export function requestRefresh() { return _get().requestRefresh(); }
export function setFetching(on: boolean) { return _get().setFetching(on); }
export function setLastOkTs(ts: number) { return _get().setLastOkTs(ts); }
export function getConfig() { return _get().getConfig(); }
export function applyConfig(cfg: Partial<PollerConfig>) { return _get().applyConfig(cfg); }
export function setDbActivity(idx?: number) { return _get().setDbActivity(idx); }
