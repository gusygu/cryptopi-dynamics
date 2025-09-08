// src/core/frozen.ts
export async function getFrozenSetFromMatricesLatest(appSessionId: string, cycleTs: number) {
  const base = process.env.INTERNAL_BASE_URL || 'http://localhost:3000';
  const url =
    `${base}/api/matrices/latest` +
    `?appSessionId=${encodeURIComponent(appSessionId)}` +
    `&cycleTs=${cycleTs}&t=${Date.now()}`;

  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) return new Set<string>();

  const j = await r.json();
  const coins: string[] = Array.isArray(j?.coins)
    ? j.coins.map((c: any) => String(c).toUpperCase())
    : [];

  const grid: boolean[][] | undefined =
    Array.isArray(j?.flags?.id_pct) ? (j.flags.id_pct as boolean[][])
    : j?.flags?.id_pct?.frozen;

  if (!coins.length || !grid) return new Set<string>();

  const set = new Set<string>();
  for (let i = 0; i < coins.length; i++) {
    for (let jdx = 0; jdx < coins.length; jdx++) {
      if (grid[i]?.[jdx]) set.add(`${coins[i]}|${coins[jdx]}`);
    }
  }
  return set;
}
