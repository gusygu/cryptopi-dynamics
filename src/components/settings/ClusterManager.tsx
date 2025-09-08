"use client";

import React, { useEffect, useMemo, useState } from "react";

export type Cluster = {
  id: string;
  name: string;
  coins: string[];
};

export type ClusterManagerProps = {
  /** Only coins from this list can be used in clusters (e.g. your CoinSelector selection) */
  availableCoins: string[];
  /** Current clusters (length defines how many cards you see) */
  value: Cluster[];
  /** Upstream update */
  onChange: (next: Cluster[]) => void;
  /** UI knobs */
  min?: number;
  max?: number;
  title?: string;
};

const uc = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const uniq = <T,>(arr: T[]) => Array.from(new Set(arr));

function makeCluster(idx: number): Cluster {
  return { id: `cl-${Date.now()}-${idx}`, name: `Cluster ${idx + 1}`, coins: [] };
}

export default function ClusterManager({
  availableCoins,
  value,
  onChange,
  min = 1,
  max = 8,
  title = "Clusters",
}: ClusterManagerProps) {
  // sanitize clusters when availableCoins change
  useEffect(() => {
    const allowed = new Set(availableCoins.map(uc));
    const next = value.map((c) => ({
      ...c,
      coins: c.coins.map(uc).filter((x) => allowed.has(x)),
    }));
    // only push if something changed
    const changed =
      JSON.stringify(value.map((c) => c.coins).flat()) !==
      JSON.stringify(next.map((c) => c.coins).flat());
    if (changed) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableCoins.join("|")]);

  const count = value.length;

  function setCount(n: number) {
    const target = Math.max(min, Math.min(max, Math.floor(n)));
    if (target === value.length) return;
    if (target > value.length) {
      const add = Array.from({ length: target - value.length }, (_, i) =>
        makeCluster(value.length + i)
      );
      onChange([...value, ...add]);
    } else {
      onChange(value.slice(0, target));
    }
  }

  function rename(id: string, name: string) {
    onChange(value.map((c) => (c.id === id ? { ...c, name } : c)));
  }

  function addCoin(id: string, coinRaw: string) {
    const coin = uc(coinRaw);
    if (!availableCoins.includes(coin)) return;
    onChange(
      value.map((c) =>
        c.id === id ? { ...c, coins: uniq([...c.coins, coin]) } : c
      )
    );
  }

  function removeCoin(id: string, coin: string) {
    onChange(
      value.map((c) =>
        c.id === id ? { ...c, coins: c.coins.filter((x) => x !== coin) } : c
      )
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-300 font-semibold">{title}</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCount(count - 1)}
            className="rounded-lg border border-slate-800 px-2 py-1 text-xs hover:bg-slate-800 disabled:opacity-40"
            disabled={count <= min}
            aria-label="Decrease clusters"
            title="Decrease clusters"
          >
            −
          </button>
          <input
            type="number"
            min={min}
            max={max}
            value={count}
            onChange={(e) => setCount(Number(e.target.value || min))}
            className="w-16 rounded-lg bg-slate-900/60 border border-slate-800 px-2 py-1 text-sm text-center"
          />
          <button
            type="button"
            onClick={() => setCount(count + 1)}
            className="rounded-lg border border-slate-800 px-2 py-1 text-xs hover:bg-slate-800 disabled:opacity-40"
            disabled={count >= max}
            aria-label="Increase clusters"
            title="Increase clusters"
          >
            +
          </button>
        </div>
      </div>

      {/* Cards */}
      <div className="grid gap-3 md:grid-cols-2">
        {value.map((cl, idx) => (
          <ClusterCard
            key={cl.id}
            idx={idx}
            cluster={cl}
            availableCoins={availableCoins}
            onRename={(name) => rename(cl.id, name)}
            onAdd={(coin) => addCoin(cl.id, coin)}
            onRemove={(coin) => removeCoin(cl.id, coin)}
          />
        ))}
      </div>
    </div>
  );
}

function ClusterCard({
  idx,
  cluster,
  availableCoins,
  onRename,
  onAdd,
  onRemove,
}: {
  idx: number;
  cluster: Cluster;
  availableCoins: string[];
  onRename: (name: string) => void;
  onAdd: (coin: string) => void;
  onRemove: (coin: string) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);

  const coinsSet = useMemo(() => new Set(cluster.coins.map(uc)), [cluster.coins]);

  const suggestions = useMemo(() => {
    const needle = uc(q);
    const base = needle
      ? availableCoins.filter((c) => c.includes(needle))
      : availableCoins;
    const out = base.filter((c) => !coinsSet.has(c)).slice(0, 12);
    // exact match to top
    out.sort((a, b) => {
      const ax = a === needle ? -1 : 0;
      const bx = b === needle ? -1 : 0;
      if (ax !== bx) return ax - bx;
      return a.localeCompare(b);
    });
    return out;
  }, [q, availableCoins, coinsSet]);

  const canAdd = useMemo(() => {
    const t = uc(q);
    return t && availableCoins.includes(t) && !coinsSet.has(t);
  }, [q, availableCoins, coinsSet]);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <input
          value={cluster.name}
          onChange={(e) => onRename(e.target.value)}
          className="min-w-0 rounded-lg bg-slate-900/60 border border-slate-800 px-2 py-1 text-sm"
        />
        <span className="text-[11px] text-slate-400">#{idx + 1}</span>
      </div>

      <div className="relative mb-2">
        <div className="flex gap-2">
          <input
            value={q}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
              setHi(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHi((h) => Math.min(h + 1, Math.max(0, suggestions.length - 1)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHi((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (open && suggestions.length > 0) onAdd(suggestions[hi] ?? q);
                else if (canAdd) onAdd(q);
                setQ("");
                setOpen(false);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="Add coin from selector…"
            className="w-full rounded-xl bg-slate-900/60 border border-slate-800 px-3 py-2 text-sm font-mono"
          />
          <button
            onClick={() => {
              if (canAdd) onAdd(q);
              setQ("");
              setOpen(false);
            }}
            disabled={!canAdd}
            className={`rounded-xl border px-3 py-2 text-sm ${
              canAdd ? "border-slate-700 hover:bg-slate-800" : "border-slate-800 opacity-50 cursor-not-allowed"
            }`}
          >
            Add
          </button>
        </div>

        {open && suggestions.length > 0 && (
          <div className="absolute z-10 mt-1 max-h-52 w-full overflow-auto rounded-xl border border-slate-800 bg-slate-950/95 p-1 shadow-lg">
            {suggestions.map((s, i) => {
              const active = i === hi;
              return (
                <button
                  key={s}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => {
                    onAdd(s);
                    setQ("");
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-sm ${
                    active ? "bg-slate-800/80" : "hover:bg-slate-900/70"
                  }`}
                >
                  <span className="font-mono">{s}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* pills */}
      <div className="flex flex-wrap gap-2">
        {cluster.coins.length === 0 ? (
          <span className="text-xs text-slate-500">No coins in this cluster.</span>
        ) : (
          cluster.coins.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 rounded-full bg-slate-800/60 border border-slate-700 px-2 py-1 text-xs"
            >
              <span className="font-mono">{c}</span>
              <button
                onClick={() => onRemove(c)}
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
