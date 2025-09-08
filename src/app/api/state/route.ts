// Lightweight in-memory session key helpers used by older lab endpoints.
// Kept minimal to avoid heavy dependencies in the new structure.

type Key = string; // `${base}:${quote}:${appSessionId}`

export interface EngineState { }

const store = new Map<Key, EngineState>();

export function keyOf(pair: { base: string; quote: string; appSessionId: string }): Key {
  return `${pair.base}:${pair.quote}:${pair.appSessionId}`;
}

export function getEngine(pair: { base: string; quote: string; appSessionId: string }): EngineState {
  const k = keyOf(pair);
  let s = store.get(k);
  if (!s) { s = {}; store.set(k, s); }
  return s;
}

export function clearBySession(appSessionId: string): number {
  const suffix = `:${appSessionId}`;
  let removed = 0;
  for (const k of Array.from(store.keys())) {
    if (k.endsWith(suffix)) { store.delete(k); removed++; }
  }
  return removed;
}
