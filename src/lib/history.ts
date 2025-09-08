// src/lib/history.ts (optional; future UI playback)
export async function fetchSnapshotAt(ts: number) {
  const r = await fetch(`/api/matrices/at?ts=${ts}`, { cache: 'no-store' });
  return r.json();
}
