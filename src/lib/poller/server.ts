import "server-only";

import { getAll as getSettings } from "@/lib/settings/server";
import { DEFAULT_SETTINGS, type AppSettings } from "@/lib/settings/schema";

export type ServerPollerSnapshot = {
  baseMs: number;
  baseSeconds: number;
  secondaryEnabled: boolean;
  secondaryCycles: number;
  secondaryMs: number | null;
  computedAt: number;
  settingsVersion: number;
};

export type PollerTickEvent = {
  type: "tick";
  at: number;
  seq: number;
  config: ServerPollerSnapshot;
};

export type PollerListener = (event: PollerTickEvent) => void | Promise<void>;

const MIN_BASE_MS = 500;

function computeSnapshot(settings: AppSettings): ServerPollerSnapshot {
  const baseMsRaw = Number(settings?.timing?.autoRefreshMs ?? NaN);
  const fallbackMs = Number((settings as any)?.poller?.dur40 ?? (settings as any)?.metronome?.dur40 ?? NaN);
  let baseMs = Number.isFinite(baseMsRaw) && baseMsRaw > 0 ? baseMsRaw : NaN;
  if (!Number.isFinite(baseMs) || baseMs <= 0) {
    baseMs = Number.isFinite(fallbackMs) && fallbackMs > 0 ? fallbackMs * 1000 : 40_000;
  }
  baseMs = Math.max(MIN_BASE_MS, Math.round(baseMs));
  const baseSeconds = Math.max(1, Math.round(baseMs / 1000));
  const secondaryEnabled = !!settings?.timing?.secondaryEnabled;
  const cyclesRaw = Number(settings?.timing?.secondaryCycles ?? (settings as any)?.poller?.secondaryCycles ?? NaN);
  const secondaryCycles = Math.max(1, Math.min(10, Number.isFinite(cyclesRaw) ? cyclesRaw : 3));
  const secondaryMs = secondaryEnabled ? baseMs * secondaryCycles : null;

  return {
    baseMs,
    baseSeconds,
    secondaryEnabled,
    secondaryCycles,
    secondaryMs,
    computedAt: Date.now(),
    settingsVersion: Number(settings?.version ?? DEFAULT_SETTINGS.version),
  };
}

let cachedSnapshot: ServerPollerSnapshot | null = null;
let cachedVersion: number | null = null;

export async function getPollerSnapshot(force = false): Promise<ServerPollerSnapshot> {
  const settings = await getSettings().catch(() => DEFAULT_SETTINGS);
  if (!force && cachedSnapshot && cachedVersion === settings.version) {
    return cachedSnapshot;
  }
  const snapshot = computeSnapshot(settings);
  cachedSnapshot = snapshot;
  cachedVersion = settings.version;
  return snapshot;
}

export function invalidatePollerSnapshot() {
  cachedSnapshot = null;
  cachedVersion = null;
}

class UniversalPoller {
  private listeners = new Set<PollerListener>();
  private timer: NodeJS.Timeout | null = null;
  private seq = 0;
  private current: ServerPollerSnapshot | null = null;
  private refreshing: Promise<void> | null = null;

  async snapshot(force = false): Promise<ServerPollerSnapshot> {
    if (this.refreshing) {
      await this.refreshing;
    }
    if (!force && this.current) return this.current;
    this.refreshing = (async () => {
      this.current = await getPollerSnapshot(force);
    })();
    await this.refreshing;
    this.refreshing = null;
    return this.current!;
  }

  subscribe(listener: PollerListener) {
    this.listeners.add(listener);
    void this.ensureTimer();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.stop();
    };
  }

  async refresh() {
    await this.ensureTimer(true);
  }

  private stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async ensureTimer(force = false) {
    if (this.refreshing) await this.refreshing;
    this.refreshing = (async () => {
      this.current = await getPollerSnapshot(force);
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      if (!this.listeners.size) return;
      const interval = Math.max(MIN_BASE_MS, this.current.baseMs);
      this.timer = setInterval(() => this.emit(), interval);
      if (typeof (this.timer as any)?.unref === "function") {
        (this.timer as any).unref();
      }
    })();
    await this.refreshing;
    this.refreshing = null;
  }

  private emit() {
    if (!this.current) return;
    this.seq += 1;
    const ev: PollerTickEvent = {
      type: "tick",
      at: Date.now(),
      seq: this.seq,
      config: this.current,
    };
    for (const listener of this.listeners) {
      Promise.resolve(listener(ev)).catch((err) => {
        if (process.env.NODE_ENV !== "production") {
          console.error("[poller] listener error", err);
        }
      });
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __cryptopi_universal_poller__: UniversalPoller | undefined;
}

export async function getUniversalPoller(): Promise<UniversalPoller> {
  if (!(globalThis as any).__cryptopi_universal_poller__) {
    (globalThis as any).__cryptopi_universal_poller__ = new UniversalPoller();
  }
  const poller: UniversalPoller = (globalThis as any).__cryptopi_universal_poller__;
  await poller.snapshot();
  return poller;
}

export async function subscribeToPoller(listener: PollerListener) {
  const poller = await getUniversalPoller();
  return poller.subscribe(listener);
}

export async function refreshUniversalPoller() {
  const poller = await getUniversalPoller();
  await poller.refresh();
}

export type { UniversalPoller };