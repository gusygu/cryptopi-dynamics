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
  startedAt: number;       // ms
  lastOkTs?: number;       // ms (server data freshness)
  // optional external telemetry
  dbActivity?: number;     // 0..100 UI index
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
const nowSec = () => Math.floor(Date.now() / 1000);

const TAB_ID = (() => {
  try { return (Math.random().toString(36).slice(2) + Date.now().toString(36)); } catch { return "tab"; }
})();
const BC_NAME = "cryptopi-poller";
const LS_KEY_LEADER = "cryptopi:poller:leader";
const LS_KEY_STATE  = "cryptopi:poller:lastState";   // persisted counters for hydration

const FALLBACK_CONFIG: PollerConfig = { cycle40: 40, cycle120: 120 };

type PersistShape = {
  ts: number;          // seconds
  dur40: number;
  dur120: number;
  remaining40: number;
  remaining120: number;
  phase: Phase;
  enabled: boolean;
};

class ClientPoller {
  private bc?: BroadcastChannel;
  private subs = new Set<Subscriber>();
  private leader = false;

  private timer?: number;           // 1s tick interval
  private heartbeatTimer?: number;  // localStorage heartbeat
  private lastSec = nowSec();

  private config: PollerConfig = { ...FALLBACK_CONFIG };
  private lastBroadcastTickSec = 0;

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
    if (typeof window === "undefined") return;

    this.bc = new BroadcastChannel(BC_NAME);
    this.bc.onmessage = (e) => this.onMessage(e.data as PollerEvent);

    window.addEventListener("storage", this.onStorage);
    window.addEventListener("beforeunload", () => { if (this.leader) this.releaseLeadership(); });

    // Hydrate counters from last persisted state (so new tabs align with the global clock)
    this.hydrateFromLocalStorage();

    // Elect a single leader (tab) to run the timers
    this.electLeader();

    // Load config from Settings (non-blocking; falls back to defaults)
    this.loadConfigFromSettings().catch(() => {});

    // Immediately notify subscribers with the hydrated state
    this.emit({ type: "state", state: this.state });
  }

  /* -------------------------- Settings / Config -------------------------- */

  private sanitizeConfig(input: any): PollerConfig {
    const c40  = Number(input?.poll?.cycle40  ?? input?.cycle40  ?? FALLBACK_CONFIG.cycle40);
    const c120 = Number(input?.poll?.cycle120 ?? input?.cycle120 ?? FALLBACK_CONFIG.cycle120);
    const valid = (n: number, def: number) => Number.isFinite(n) && n >= 5 && n <= 600 ? Math.floor(n) : def;
    return { cycle40: valid(c40, FALLBACK_CONFIG.cycle40), cycle120: valid(c120, FALLBACK_CONFIG.cycle120) };
  }

  private async loadConfigFromSettings() {
    try {
      const res = await fetch("/api/settings?scope=poller", { cache: "no-store" });
      if (!res.ok) return;
      const cfg = this.sanitizeConfig(await res.json());
      this.applyConfigInternal(cfg, /*initial*/ false);
    } catch {
      /* noop */
    }
  }

  private applyConfigInternal(cfg: PollerConfig, initial: boolean) {
    this.config = { ...cfg };
    this.state.dur40 = cfg.cycle40;
    this.state.dur120 = cfg.cycle120;

    if (initial) {
      this.state.remaining40 = cfg.cycle40;
      this.state.remaining120 = cfg.cycle120;
    } else {
      // Clamp remaining to new caps
      this.state.remaining40 = Math.min(this.state.remaining40, cfg.cycle40);
      this.state.remaining120 = Math.min(this.state.remaining120, cfg.cycle120);
    }

    // Broadcast both config & state (followers mirror)
    this.broadcast({ type: "config", config: this.config });
    this.emit({ type: "config", config: this.config });
    this.broadcast({ type: "state", state: this.state });
    this.emit({ type: "state", state: this.state });

    // Persist to LS so late-joining tabs hydrate with the right durations
    this.persistToLocalStorage();
  }

  /* Public: push settings from UI (Settings page) */
  applyConfig(partial: Partial<PollerConfig>) {
    const merged: PollerConfig = {
      cycle40: Math.floor(partial.cycle40 ?? this.config.cycle40 ?? FALLBACK_CONFIG.cycle40),
      cycle120: Math.floor(partial.cycle120 ?? this.config.cycle120 ?? FALLBACK_CONFIG.cycle120),
    };
    this.applyConfigInternal(merged, /*initial*/ false);
  }
  getConfig(): PollerConfig { return { ...this.config }; }

  /* --------------------------- Leader election --------------------------- */

  private onStorage = (ev: StorageEvent) => {
    if (ev.key !== LS_KEY_LEADER) return;
    this.electLeader();
  };

  private readLeader(): { id: string; ts: number } | null {
    try {
      const raw = localStorage.getItem(LS_KEY_LEADER);
      if (!raw) return null;
      const j = JSON.parse(raw) as { id?: string; ts?: number };
      if (!j?.id || !Number.isFinite(j?.ts)) return null;
      return { id: String(j.id), ts: Number(j.ts) };
    } catch { return null; }
  }

  private writeLeader() {
    try {
      localStorage.setItem(LS_KEY_LEADER, JSON.stringify({ id: TAB_ID, ts: Date.now() }));
    } catch {}
  }

  private releaseLeadership() {
    this.stopTimers();
    if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    if (this.leader) {
      this.leader = false;
      try { localStorage.removeItem(LS_KEY_LEADER); } catch {}
      this.state.isLeader = false;
      this.broadcast({ type: "state", state: this.state });
      this.emit({ type: "state", state: this.state });
    }
  }

  private electLeader() {
    const cur = Date.now();
    const other = this.readLeader();
    const STALE_MS = 6_000; // if last heartbeat is older than this, take over

    const shouldTake = !other || (cur - other.ts) > STALE_MS;

    if (shouldTake) {
      // Become leader
      this.leader = true;
      this.state.isLeader = true;
      this.writeLeader();

      // start heartbeat to keep leadership fresh
      if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = window.setInterval(() => this.writeLeader(), 2_000);

      // drive the single metronome
      this.startTimers();
    } else {
      // Follower
      this.leader = false;
      this.state.isLeader = false;
      this.stopTimers();
    }

    this.broadcast({ type: "state", state: this.state });
    this.emit({ type: "state", state: this.state });
  }

  /* ------------------------------- Timers -------------------------------- */

  private startTimers() {
    if (this.timer) return;
    this.lastSec = nowSec();
    this.timer = window.setInterval(() => this.tick(), 1_000);
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

      // per-second tick for followers (throttle duplicate broadcasts)
      this.safeBroadcastTick({
        type: "tick",
        sec: cur,
        remaining40: this.state.remaining40,
        remaining120: this.state.remaining120,
        phase: this.state.phase,
      });
      this.emit({
        type: "tick",
        sec: cur,
        remaining40: this.state.remaining40,
        remaining120: this.state.remaining120,
        phase: this.state.phase,
      });

      // 40s boundary
      if (this.state.remaining40 <= 0) {
        const isThird = this.state.phase === 3 || this.state.remaining120 <= 0;
        this.state.remaining40 = this.state.dur40;
        this.state.phase = (this.state.phase % 3 + 1) as Phase;
        this.state.cyclesCompleted += 1;

        this.broadcast({ type: "tick40", phase: this.state.phase, isThird });
        this.emit({ type: "tick40", phase: this.state.phase, isThird });
      }
      // 120s boundary
      if (this.state.remaining120 <= 0) {
        this.state.remaining120 = this.state.dur120;
        this.broadcast({ type: "tick120" });
        this.emit({ type: "tick120" });
      }
    }

    // persist counters so late-joining tabs hydrate accurately
    this.persistToLocalStorage();

    // mirror state
    this.broadcast({ type: "state", state: this.state });
    this.emit({ type: "state", state: this.state });
  }

  private safeBroadcastTick(ev: Extract<PollerEvent, { type: "tick" }>) {
    try {
      const s = ev.sec;
      if ((this as any).__lastTickSec === s) return;
      (this as any).__lastTickSec = s;
      this.bc?.postMessage(ev);
    } catch {}
  }

  /* ---------------------------- Persistence ---------------------------- */

  private persistToLocalStorage() {
    try {
      const p: PersistShape = {
        ts: nowSec(),
        dur40: this.state.dur40,
        dur120: this.state.dur120,
        remaining40: this.state.remaining40,
        remaining120: this.state.remaining120,
        phase: this.state.phase,
        enabled: this.state.enabled,
      };
      localStorage.setItem(LS_KEY_STATE, JSON.stringify(p));
    } catch {}
  }

  private hydrateFromLocalStorage() {
    try {
      const raw = localStorage.getItem(LS_KEY_STATE);
      if (!raw) return;
      const saved = JSON.parse(raw) as PersistShape | null;
      if (!saved || !Number.isFinite(saved.ts)) return;

      // Use saved durations as initial config; Settings may update later
      this.state.dur40 = Number(saved.dur40) || FALLBACK_CONFIG.cycle40;
      this.state.dur120 = Number(saved.dur120) || FALLBACK_CONFIG.cycle120;
      this.config = { cycle40: this.state.dur40, cycle120: this.state.dur120 };

      // Rewind the counters by elapsed time — this makes a new tab show the same t-minus
      const elapsed = Math.max(0, nowSec() - Number(saved.ts));
      const r40 = ((Number(saved.remaining40) || this.state.dur40) - (elapsed % this.state.dur40));
      const r120 = ((Number(saved.remaining120) || this.state.dur120) - (elapsed % this.state.dur120));

      this.state.remaining40 = r40 > 0 ? r40 : this.state.dur40 + r40;     // wrap if negative
      this.state.remaining120 = r120 > 0 ? r120 : this.state.dur120 + r120;
      this.state.phase = saved.phase ?? 1;
      this.state.enabled = saved.enabled ?? true;
    } catch {
      /* ignore */
    }
  }

  /* ---------------------------- Messaging API ---------------------------- */

  private onMessage(ev: PollerEvent) {
    if (ev.type === "state") {
      if (!this.leader) {
        // followers mirror leader's state and durations
        const s = ev.state;
        this.state = { ...s, isLeader: false };
        this.config = { cycle40: s.dur40, cycle120: s.dur120 };
        // persist mirrored state to keep LS counters fresh
        this.persistToLocalStorage();
      }
    } else if (ev.type === "config") {
      if (!this.leader) {
        this.applyConfigInternal(ev.config, /*initial*/ false);
      }
    }
    this.emit(ev);
    if (!this.leader) this.electLeader();
  }

  private emit(ev: PollerEvent) {
    for (const fn of this.subs) {
      try { fn(ev); } catch {}
    }
  }
  private broadcast(ev: PollerEvent) {
    try { this.bc?.postMessage(ev); } catch {}
  }

  /* ----------------------------- Public ops ----------------------------- */

  subscribe(fn: Subscriber) {
    this.subs.add(fn);
    fn({ type: "state", state: this.state });
    return () => { this.subs.delete(fn); };
  }
  getState(): PollerState { return this.state; }

  setEnabled(on: boolean) {
    this.state.enabled = on;
    if (this.leader) { on ? this.startTimers() : this.stopTimers(); }
    this.broadcast({ type: "state", state: this.state });
    this.emit({ type: "state", state: this.state });
    this.persistToLocalStorage();
  }

  requestRefresh() {
    this.broadcast({ type: "refresh" });
    this.emit({ type: "refresh" });
  }

  setFetching(on: boolean) {
    this.state.isFetching = on;
    this.broadcast({ type: on ? "fetch:start" : "fetch:success", ts: Date.now() });
    this.broadcast({ type: "state", state: this.state });
    this.emit({ type: "state", state: this.state });
  }

  setLastOkTs(ts: number) {
    this.state.lastOkTs = ts;
    this.broadcast({ type: "state", state: this.state });
    this.emit({ type: "state", state: this.state });
  }

  setDbActivity(idx?: number) {
    if (idx == null || !Number.isFinite(idx)) return;
    const clamped = Math.max(0, Math.min(100, Math.round(Number(idx))));
    this.state.dbActivity = clamped;
    this.broadcast({ type: "state", state: this.state });
    this.emit({ type: "state", state: this.state });
  }
}

/* -------------------------- HMR-safe singleton -------------------------- */

declare global { // eslint-disable-next-line no-var
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

/* ------------------------------- Exports -------------------------------- */

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
