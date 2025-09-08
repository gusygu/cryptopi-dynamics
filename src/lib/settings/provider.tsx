// src/lib/settings/provider.tsx
"use client";

import React, { createContext, useCallback, useEffect, useMemo, useState } from "react";
import { AppSettings, DEFAULT_SETTINGS, migrateSettings } from "./schema";

const STORAGE_KEY = "appSettings";

type Ctx = {
  settings: AppSettings;
  setAll: (next: AppSettings) => Promise<void>;
  update: (patch: Partial<AppSettings>) => Promise<void>;
  reload: () => void;
};

const SettingsCtx = createContext<Ctx>({
  settings: DEFAULT_SETTINGS,
  async setAll() {},
  async update() {},
  reload() {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  // Load from localStorage first for instant hydration, then reconcile with server cookie
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSettings(migrateSettings(JSON.parse(raw)));
    } catch {}
    (async () => {
      try {
        const r = await fetch("/api/settings", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (j?.settings) setSettings(migrateSettings(j.settings));
      } catch {}
    })();
  }, []);

  // Cross-tab sync
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY && e.newValue) {
        setSettings(migrateSettings(JSON.parse(e.newValue)));
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setAll = useCallback(async (next: AppSettings) => {
    const clean = migrateSettings(next);
    // local copy
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    setSettings(clean);
    // server cookie
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: clean }),
      });
    } catch {}
    // legacy events (your app already listens to these)
    window.dispatchEvent(new CustomEvent("app-settings:updated", { detail: clean }));
    window.dispatchEvent(new CustomEvent("app-settings:coins-changed", { detail: { coins: clean.coinUniverse } }));
    window.dispatchEvent(new CustomEvent("app-settings:clusters-changed", { detail: clean.clustering }));
    window.dispatchEvent(new CustomEvent("app-settings:timing-changed", { detail: clean.timing }));
    window.dispatchEvent(new CustomEvent("app-settings:params-changed", { detail: clean.params }));
  }, []);

  const update = useCallback(async (patch: Partial<AppSettings>) => {
    await setAll({ ...settings, ...patch });
  }, [settings, setAll]);

  const reload = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSettings(migrateSettings(JSON.parse(raw)));
    } catch {}
  }, []);

  const value = useMemo(() => ({ settings, setAll, update, reload }), [settings, setAll, update, reload]);

  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings() {
  return React.useContext(SettingsCtx);
}
