"use client";

import React, { useEffect, useMemo, useState } from "react";
import CoinSelector from "@/components/settings/CoinSelector";
import ClusterManager, { Cluster } from "@/components/settings/ClusterManager";
import { useSettings } from "@/lib/settings/provider";
import {
  AppSettings,
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
} from "@/lib/settings/schema";

/* =========================
   Local helpers (no schema type duplication)
========================= */

type PreviewMode = { quote: "ANY" | "USDT" | "BTC" | "ETH"; spotOnly: boolean };

const STORAGE_KEY = "appSettings";
const SESSION_BINANCE_SECRET = "binance.secret";

function loadSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const s = JSON.parse(raw) as Partial<AppSettings>;
    const u = (xs?: string[]) =>
      Array.from(new Set((xs ?? []).map((x) => String(x).toUpperCase())));
    const num = (v: any, d: number) => (Number.isFinite(+v) ? +v : d);

    return {
      version: SETTINGS_VERSION,
      coinUniverse: u(s.coinUniverse),
      profile: {
        nickname: String(s.profile?.nickname ?? ""),
        email: String(s.profile?.email ?? ""),
        binanceKeyId: String(s.profile?.binanceKeyId ?? ""),
      },
      stats: {
        histogramLen: Math.max(16, num(s.stats?.histogramLen, DEFAULT_SETTINGS.stats.histogramLen)),
        bmDecimals: Math.max(0, Math.min(6, num(s.stats?.bmDecimals, DEFAULT_SETTINGS.stats.bmDecimals))),
        idPctDecimals: Math.max(0, Math.min(8, num(s.stats?.idPctDecimals, DEFAULT_SETTINGS.stats.idPctDecimals))),
      },
      timing: {
        autoRefresh: Boolean(s.timing?.autoRefresh ?? DEFAULT_SETTINGS.timing.autoRefresh),
        autoRefreshMs: Math.max(500, num(s.timing?.autoRefreshMs, DEFAULT_SETTINGS.timing.autoRefreshMs)),
        secondaryEnabled: Boolean(s.timing?.secondaryEnabled ?? DEFAULT_SETTINGS.timing.secondaryEnabled),
        secondaryCycles: Math.max(1, Math.min(10, num(s.timing?.secondaryCycles, DEFAULT_SETTINGS.timing.secondaryCycles))),
        strCycles: {
          m30: Math.max(1, num(s.timing?.strCycles?.m30, DEFAULT_SETTINGS.timing.strCycles.m30)),
          h1:  Math.max(1, num(s.timing?.strCycles?.h1,  DEFAULT_SETTINGS.timing.strCycles.h1)),
          h3:  Math.max(1, num(s.timing?.strCycles?.h3,  DEFAULT_SETTINGS.timing.strCycles.h3)),
        },
      },
      clustering: {
        clusters: Array.isArray(s.clustering?.clusters)
          ? (s.clustering!.clusters as Cluster[]).map((c, i) => ({
              id: String(c?.id ?? `cl-${i + 1}`),
              name: String(c?.name ?? `Cluster ${i + 1}`),
              coins: u(c?.coins),
            }))
          : DEFAULT_SETTINGS.clustering.clusters,
      },
      params: {
        values: { ...DEFAULT_SETTINGS.params.values, ...(s.params?.values ?? {}) },
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const sToLabel = (sec: number) => {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const r = Math.round(sec % 60);
  return r ? `${m}m ${r}s` : `${m}m`;
};
const cyclesToSec = (cycles: number, baseMs: number) => (cycles * baseMs) / 1000;
function sanitizeParams(values: Record<string, number>) {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(values)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/* =========================
   Component
========================= */
export default function SettingsPage() {
  const { setAll } = useSettings(); // provider for global persistence

  // ---- preview (Binance) ----
  const [mode, setMode] = useState<PreviewMode>({ quote: "ANY", spotOnly: true });
  const [previewCoins, setPreviewCoins] = useState<string[]>([]);
  const [previewUpdatedAt, setPreviewUpdatedAt] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // ---- settings (local edit buffer) ----
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // email confirm & binance secret (session-only)
  const [email2, setEmail2] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const emailOk = settings.profile.email.length === 0 || settings.profile.email === email2;

  // load settings once (from localStorage)
  useEffect(() => setSettings(loadSettings()), []);

  // fetch Binance preview
  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    (async () => {
      setLoadingPreview(true);
      setPreviewError(null);
      try {
        const params = new URLSearchParams();
        params.set("spot", mode.spotOnly ? "1" : "0");
        if (mode.quote !== "ANY") params.set("quote", mode.quote);
        const res = await fetch(`/api/providers/binance/preview?${params}`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        const coins: string[] = Array.isArray(j?.coins) ? j.coins : [];
        if (!alive) return;
        setPreviewCoins(Array.from(new Set(coins.map((s) => s.toUpperCase()))).sort());
        setPreviewUpdatedAt(String(j?.updatedAt ?? new Date().toISOString()));
      } catch (e: any) {
        if (!alive) return;
        setPreviewError(e?.message || "Failed to load preview");
      } finally {
        if (alive) setLoadingPreview(false);
      }
    })();
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [mode.quote, mode.spotOnly]);

  // selected coins must exist in preview
  const selectedValid = useMemo(
    () => (previewCoins.length ? settings.coinUniverse.filter((c) => previewCoins.includes(c)) : settings.coinUniverse),
    [settings.coinUniverse, previewCoins]
  );

  function updateCoins(next: string[]) {
    const upper = Array.from(new Set(next.map((s) => s.toUpperCase())));
    const filtered = previewCoins.length ? upper.filter((c) => previewCoins.includes(c)) : upper;
    setSettings((s) => ({ ...s, coinUniverse: filtered }));
  }
  function setClusters(next: Cluster[]) {
    setSettings((s) => ({ ...s, clustering: { clusters: next } }));
  }

  // --- Timing helpers
  const baseSec = Math.round(settings.timing.autoRefreshMs / 1000);
  const secondaryLabel = useMemo(() => {
    const totalSec = cyclesToSec(settings.timing.secondaryCycles, settings.timing.autoRefreshMs);
    return `${settings.timing.secondaryCycles} cycles × ${baseSec}s = ${sToLabel(totalSec)}`;
  }, [settings.timing.secondaryCycles, settings.timing.autoRefreshMs]);

  function autoCalcStrCycles() {
    // Compute cycles that best approximate 30m/1h/3h using current base
    const sec = settings.timing.autoRefreshMs / 1000;
    const round = (target: number) => Math.max(1, Math.round(target / sec));
    const next = { m30: round(30 * 60), h1: round(60 * 60), h3: round(3 * 60 * 60) };
    setSettings((s) => ({ ...s, timing: { ...s.timing, strCycles: next } }));
  }

  // --- Save/Reset
  async function handleSave() {
    const out: AppSettings = {
      ...settings,
      version: settings.version ?? SETTINGS_VERSION,
      coinUniverse: selectedValid,
      clustering: {
        clusters: settings.clustering.clusters.map((c, i) => ({
          id: c.id || `cl-${i + 1}`,
          name: c.name || `Cluster ${i + 1}`,
          coins: c.coins.filter((x) => selectedValid.includes(x)),
        })),
      },
      params: { values: sanitizeParams(settings.params.values) },
    };

    // Persist via provider (writes localStorage + cookie + emits events)
    await setAll(out);

    // session-only secret
    if (apiSecret) sessionStorage.setItem(SESSION_BINANCE_SECRET, apiSecret);

    // local banner
    setSettings(out);
    setSavedAt(new Date().toLocaleString());
  }

  function handleReset() {
    setSettings(DEFAULT_SETTINGS);
    // Provider will overwrite on next save; also clear session secret
    sessionStorage.removeItem(SESSION_BINANCE_SECRET);
    setApiSecret("");
    setSavedAt(new Date().toLocaleString());
  }

  // --- UI bits
  const badge = (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-800 bg-slate-900/60 px-2 py-0.5 text-[11px] text-slate-300">
      <span className="opacity-70">selected</span>
      <span className="font-mono tabular-nums">{selectedValid.length}</span>
    </span>
  );

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl p-4 lg:p-6 space-y-6">
        {/* Header */}
        <header className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl lg:text-3xl font-semibold">App Settings</h1>
            <p className="text-sm text-slate-400">Global preferences applied across the entire app</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleReset} className="rounded-xl border border-slate-800 px-3 py-2 text-sm hover:bg-slate-800">
              Reset
            </button>
            <button
              onClick={handleSave}
              className="rounded-xl border border-slate-800 px-3 py-2 text-sm hover:bg-slate-800"
              disabled={!emailOk}
              title={!emailOk ? "Email confirmation does not match" : "Save"}
            >
              Save
            </button>
          </div>
        </header>

        {savedAt && (
          <div className="rounded-xl border border-emerald-800 bg-emerald-900/30 px-3 py-2 text-emerald-200 text-sm">
            Saved at {savedAt}
          </div>
        )}

        {/* Profile */}
        <Section title="Profile">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Identity */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 grid gap-3">
              <Field label="Nickname">
                <input
                  value={settings.profile.nickname}
                  onChange={(e) => setSettings((s) => ({ ...s, profile: { ...s.profile, nickname: e.target.value } }))}
                  className="rounded-xl bg-slate-900/60 border border-slate-800 px-3 py-2 text-sm"
                  placeholder="Your display name"
                />
              </Field>
              <Field label="Registering email">
                <input
                  type="email"
                  value={settings.profile.email}
                  onChange={(e) => setSettings((s) => ({ ...s, profile: { ...s.profile, email: e.target.value.trim() } }))}
                  className="rounded-xl bg-slate-900/60 border border-slate-800 px-3 py-2 text-sm"
                  placeholder="you@example.com"
                />
              </Field>
              <Field label="Confirm email">
                <input
                  type="email"
                  value={email2}
                  onChange={(e) => setEmail2(e.target.value.trim())}
                  className={`rounded-xl bg-slate-900/60 border px-3 py-2 text-sm ${emailOk ? "border-slate-800" : "border-amber-600"}`}
                  placeholder="Re-enter email"
                />
                {!emailOk && <p className="text-xs text-amber-300 mt-1">Emails don’t match.</p>}
              </Field>
            </div>

            {/* Binance API Box (key stored in localStorage; secret in session) */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 grid gap-3">
              <div className="text-sm font-semibold text-slate-300">Binance API</div>
              <Field label="API Key (Key ID)">
                <input
                  value={settings.profile.binanceKeyId}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, profile: { ...s.profile, binanceKeyId: e.target.value.trim() } }))
                  }
                  className="rounded-xl bg-slate-900/60 border border-slate-800 px-3 py-2 text-sm font-mono"
                />
              </Field>
              <Field label="API Secret (session only)">
                <input
                  type="password"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  className="w-full rounded-xl bg-slate-900/60 border border-slate-800 px-3 py-2 text-sm font-mono"
                  placeholder="••••••••••••••••"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Secret isn’t persisted; it lives in sessionStorage for this browser session.
                </p>
              </Field>
            </div>
          </div>
        </Section>

        {/* Clustering */}
        <Section title={<div className="flex items-center justify-between"><span>Clustering</span>{badge}</div>}>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="opacity-80">Preview source:</span>
            <select
              className="rounded-lg bg-slate-900/60 border border-slate-800 px-2 py-1"
              value={mode.quote}
              onChange={(e) => setMode((m) => ({ ...m, quote: e.target.value as PreviewMode["quote"] }))}
              title="Restrict assets by quote"
            >
              <option value="ANY">All spot</option>
              <option value="USDT">USDT markets</option>
              <option value="BTC">BTC markets</option>
              <option value="ETH">ETH markets</option>
            </select>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-blue-500"
                checked={mode.spotOnly}
                onChange={(e) => setMode((m) => ({ ...m, spotOnly: e.target.checked }))}
              />
              <span>Spot only</span>
            </label>
            <span className="ml-auto">
              {loadingPreview ? (
                <span className="text-slate-500">Loading preview…</span>
              ) : previewError ? (
                <span className="text-amber-300">Preview error: {previewError}</span>
              ) : previewUpdatedAt ? (
                <span className="text-slate-500">Updated {new Date(previewUpdatedAt).toLocaleString()}</span>
              ) : null}
            </span>
          </div>

          <div className="mb-4">
            <CoinSelector
              previewCoins={previewCoins}
              value={selectedValid}
              onChange={updateCoins}
              label="Coin selector (Binance preview)"
              placeholder="Type a coin (e.g. BTC, ETH, DOGE)…"
            />
            <p className="mt-2 text-xs text-slate-500">Only coins present in the Binance preview are allowed.</p>
          </div>

          <ClusterManager
            availableCoins={selectedValid}
            value={settings.clustering.clusters}
            onChange={setClusters}
            min={1}
            max={8}
            title="Clusters (groups for UI & logic)"
          />
        </Section>

        {/* Timing Config */}
        <Section title="Timing">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Auto-refresh & secondary */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 grid gap-3">
              <div className="flex items-center justify-between">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-blue-500"
                    checked={settings.timing.autoRefresh}
                    onChange={(e) => setSettings((s) => ({ ...s, timing: { ...s.timing, autoRefresh: e.target.checked } }))}
                  />
                  <span>Enable auto-refresh</span>
                </label>
                <Pill>{`${Math.round(settings.timing.autoRefreshMs / 1000)}s`}</Pill>
              </div>

              <Field label="Base cycle (seconds)">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className="w-28 rounded-lg bg-slate-900/60 border border-slate-800 px-2 py-2 text-sm"
                    value={Math.round(settings.timing.autoRefreshMs / 1000)}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        timing: { ...s.timing, autoRefreshMs: Math.max(1, Number(e.target.value || 1)) * 1000 },
                      }))
                    }
                  />
                  <span className="text-slate-500 text-xs">sec</span>
                </div>
              </Field>

              <div className="grid gap-2">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-blue-500"
                    checked={settings.timing.secondaryEnabled}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, timing: { ...s.timing, secondaryEnabled: e.target.checked } }))
                    }
                  />
                  <span>Use secondary loop</span>
                </label>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Cycles:</span>
                  <Segmented
                    range={Array.from({ length: 10 }, (_, i) => i + 1)}
                    value={settings.timing.secondaryCycles}
                    onChange={(n) =>
                      setSettings((s) => ({ ...s, timing: { ...s.timing, secondaryCycles: n } }))
                    }
                  />
                  <Pill>{secondaryLabel}</Pill>
                </div>
              </div>
            </div>

            {/* STR sampling in cycles */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 grid gap-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-300">STR-aux sampling (in cycles)</div>
                <button
                  className="rounded-lg border border-slate-800 px-2 py-1 text-xs hover:bg-slate-800"
                  onClick={autoCalcStrCycles}
                  title="Auto-calc cycles from target durations with current base cycle"
                >
                  Auto-calc from 30m/1h/3h
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <StrCycleBox
                  label="30m"
                  cycles={settings.timing.strCycles.m30}
                  onChange={(v) => setSettings((s) => ({ ...s, timing: { ...s.timing, strCycles: { ...s.timing.strCycles, m30: Math.max(1, v) } } }))}
                  baseMs={settings.timing.autoRefreshMs}
                />
                <StrCycleBox
                  label="1h"
                  cycles={settings.timing.strCycles.h1}
                  onChange={(v) => setSettings((s) => ({ ...s, timing: { ...s.timing, strCycles: { ...s.timing.strCycles, h1: Math.max(1, v) } } }))}
                  baseMs={settings.timing.autoRefreshMs}
                />
                <StrCycleBox
                  label="3h"
                  cycles={settings.timing.strCycles.h3}
                  onChange={(v) => setSettings((s) => ({ ...s, timing: { ...s.timing, strCycles: { ...s.timing.strCycles, h3: Math.max(1, v) } } }))}
                  baseMs={settings.timing.autoRefreshMs}
                />
              </div>
            </div>
          </div>
        </Section>

        {/* Parameters */}
        <Section title="Parameters">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <ParamCard
              name="eta"
              value={settings.params.values.eta ?? DEFAULT_SETTINGS.params.values.eta}
              onChange={(v) => setSettings((s) => ({ ...s, params: { values: { ...s.params.values, eta: v } } }))}
            />
            <ParamCard
              name="epsilon"
              value={settings.params.values.epsilon ?? DEFAULT_SETTINGS.params.values.epsilon}
              onChange={(v) => setSettings((s) => ({ ...s, params: { values: { ...s.params.values, epsilon: v } } }))}
              notation="scientific"
            />
            {/* Add more params here as needed */}
          </div>
        </Section>

        {/* Stats */}
        <Section title="Stats">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-w-3xl">
            <Field label="Histogram window (samples)">
              <input
                type="number"
                min={16}
                step={8}
                className="w-full rounded-lg bg-slate-900/60 border border-slate-800 px-2 py-2 text-sm"
                value={settings.stats.histogramLen}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    stats: { ...s.stats, histogramLen: Math.max(16, Number(e.target.value || 0)) },
                  }))
                }
              />
            </Field>
            <Field label="bm decimals">
              <input
                type="number"
                min={0}
                max={6}
                className="w-full rounded-lg bg-slate-900/60 border border-slate-800 px-2 py-2 text-sm"
                value={settings.stats.bmDecimals}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    stats: { ...s.stats, bmDecimals: Math.max(0, Math.min(6, Number(e.target.value || 0))) },
                  }))
                }
              />
            </Field>
            <Field label="id_pct decimals">
              <input
                type="number"
                min={0}
                max={8}
                className="w-full rounded-lg bg-slate-900/60 border border-slate-800 px-2 py-2 text-sm"
                value={settings.stats.idPctDecimals}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    stats: { ...s.stats, idPctDecimals: Math.max(0, Math.min(8, Number(e.target.value || 0))) },
                  }))
                }
              />
            </Field>
          </div>
        </Section>
      </div>
    </div>
  );
}

/* =========================
   Reusable UI bits
========================= */
function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="text-sm font-semibold text-slate-300 mb-3">{title}</h2>
      {children}
    </section>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-slate-400">{label}</span>
      {children}
    </label>
  );
}
function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-800 bg-slate-900/60 px-2 py-0.5 text-[11px] text-slate-300">
      {children}
    </span>
  );
}
function Segmented({
  range,
  value,
  onChange,
}: {
  range: number[];
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-800 overflow-hidden">
      {range.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`px-2 py-1 text-xs ${
            n === value ? "bg-slate-800 text-slate-100" : "bg-slate-900/60 text-slate-300 hover:bg-slate-800/60"
          } border-r border-slate-800 last:border-r-0`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
function StrCycleBox({
  label,
  cycles,
  onChange,
  baseMs,
}: {
  label: string;
  cycles: number;
  onChange: (v: number) => void;
  baseMs: number;
}) {
  const sec = cyclesToSec(cycles, baseMs);
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-300 font-medium">{label}</span>
        <Pill>{sToLabel(sec)}</Pill>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="number"
          min={1}
          step={1}
          value={cycles}
          onChange={(e) => onChange(Math.max(1, Math.floor(Number(e.target.value || 1))))}
          className="w-24 rounded-lg bg-slate-900/60 border border-slate-800 px-2 py-2 text-sm"
        />
        <span className="text-xs text-slate-400">cycles</span>
      </div>
    </div>
  );
}
function ParamCard({
  name,
  value,
  onChange,
  notation,
}: {
  name: string;
  value: number;
  onChange: (v: number) => void;
  notation?: "scientific" | "fixed";
}) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 grid gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-300 font-semibold">{name}</span>
        <Pill>{formatParam(value, notation)}</Pill>
      </div>
      <input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const v = parseFloat(local);
          if (Number.isFinite(v)) onChange(v);
          else setLocal(String(value));
        }}
        className="rounded-lg bg-slate-900/60 border border-slate-800 px-2 py-2 text-sm font-mono"
        placeholder="Enter number…"
      />
    </div>
  );
}
function formatParam(v: number, notation?: "scientific" | "fixed") {
  if (notation === "scientific") return v.toExponential(2);
  if (Math.abs(v) < 0.001) return v.toExponential(2);
  return v.toString();
}
