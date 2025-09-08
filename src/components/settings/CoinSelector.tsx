"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

export type CoinSelectorProps = {
  /** Full allowed coin universe (e.g., Binance preview). Uppercase tickers. */
  previewCoins: string[];
  /** Currently selected coins */
  value: string[];
  /** Called with the new selected array */
  onChange: (next: string[]) => void;
  /** Optional label/title */
  label?: string;
  /** Optional placeholder */
  placeholder?: string;
  /** Max suggestions to show in the dropdown */
  maxSuggestions?: number;
};

export default function CoinSelector({
  previewCoins,
  value,
  onChange,
  label = "Coin selector",
  placeholder = "Type a coin (e.g. BTC, ETH, DOGE)…",
  maxSuggestions = 10,
}: CoinSelectorProps) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // sanitize to uppercase and strip non-letters/numbers
  function norm(s: string) {
    return s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  }

  const selected = value;
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const suggestions = useMemo(() => {
    const needle = norm(q);
    if (!needle) return previewCoins.slice(0, maxSuggestions);
    const contains = previewCoins.filter((c) => c.includes(needle));
    // push exact match to the front if present
    contains.sort((a, b) => {
      const ae = a === needle ? -1 : 0;
      const be = b === needle ? -1 : 0;
      if (ae !== be) return ae - be;
      return a.localeCompare(b);
    });
    return contains.slice(0, maxSuggestions);
  }, [q, previewCoins, maxSuggestions]);

  const validCurrent = useMemo(() => {
    const t = norm(q);
    return t.length > 0 && previewCoins.includes(t) && !selectedSet.has(t);
  }, [q, previewCoins, selectedSet]);

  function addCoin(sym: string) {
    const t = norm(sym);
    if (!t) return;
    if (!previewCoins.includes(t)) return;
    if (selectedSet.has(t)) return;
    onChange([...selected, t]);
    setQ("");
    setOpen(false);
    setHighlight(0);
    // notify others (simple app-bus; wire later)
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("app-settings:coins-changed", { detail: { coins: [...selected, t] } }));
    }
  }

  function removeCoin(sym: string) {
    const next = selected.filter((c) => c !== sym);
    onChange(next);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("app-settings:coins-changed", { detail: { coins: next } }));
    }
  }

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div className="grid gap-2" ref={boxRef}>
      <div className="flex items-center justify-between">
        <label className="text-xs text-slate-400">{label}</label>
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-800 bg-slate-900/60 px-2 py-0.5 text-[11px] text-slate-300">
          <span className="opacity-70">selected</span>
          <span className="font-mono tabular-nums">{selected.length}</span>
        </span>
      </div>

      {/* input + add */}
      <div className="relative">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value.toUpperCase());
              setOpen(true);
              setHighlight(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setHighlight((h) => Math.min(h + 1, Math.max(0, suggestions.length - 1)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (open && suggestions.length > 0) {
                  addCoin(suggestions[highlight] ?? q);
                } else if (validCurrent) {
                  addCoin(q);
                }
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder={placeholder}
            className="w-full rounded-xl bg-slate-900/60 border border-slate-800 px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700 font-mono"
          />
          <button
            className={`rounded-xl border px-3 py-2 text-sm ${
              validCurrent ? "border-slate-700 hover:bg-slate-800" : "border-slate-800 opacity-50 cursor-not-allowed"
            }`}
            onClick={() => addCoin(q)}
            disabled={!validCurrent}
          >
            Add
          </button>
        </div>

        {/* suggestions dropdown */}
        {open && suggestions.length > 0 && (
          <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-slate-800 bg-slate-950/95 p-1 shadow-lg">
            {suggestions.map((s, i) => {
              const disabled = selectedSet.has(s);
              const active = i === highlight;
              return (
                <button
                  key={s}
                  disabled={disabled}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => addCoin(s)}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-sm ${
                    disabled
                      ? "opacity-40 cursor-not-allowed"
                      : active
                      ? "bg-slate-800/80"
                      : "hover:bg-slate-900/70"
                  }`}
                >
                  <span className="font-mono">{s}</span>
                  {disabled ? <span className="text-[10px] text-slate-500">selected</span> : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* selected pills */}
      <div className="flex flex-wrap gap-2">
        {selected.length === 0 ? (
          <span className="text-xs text-slate-500">No coins selected yet.</span>
        ) : (
          selected.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 rounded-full bg-slate-800/60 border border-slate-700 px-2 py-1 text-xs"
            >
              <span className="font-mono">{c}</span>
              <button
                onClick={() => removeCoin(c)}
                className="rounded-full px-1 text-slate-400 hover:text-slate-100"
                aria-label={`Remove ${c}`}
                title={`Remove ${c}`}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  );
}
