// src/app/api/matrices/at/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getNearestTsAtOrBefore, getSnapshotByType, getPrevValue } from "@/core/db";
import { resolveCoins } from "@/lib/coins/resolve";

export const dynamic = "force-dynamic";
const TYPES = ["benchmark", "delta", "pct24h", "id_pct", "pct_drv"] as const;

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const tsStr = url.searchParams.get("ts");
    const tsReq = tsStr ? Number(tsStr) : NaN;

    // 🔑 settings-driven coins unless ?coins= is present
    const coins = await resolveCoins(url);

    const result: any = { ok: true, coins, ts: {}, matrices: {}, flags: {} };

    for (const t of TYPES) {
      const ts = Number.isFinite(tsReq) ? await getNearestTsAtOrBefore(t, tsReq) : null;
      result.ts[t] = ts;
      if (!ts) { result.matrices[t] = null; result.flags[t] = null; continue; }

      const snapshot = await getSnapshotByType(t, ts, coins);
      const n = coins.length;
      const grid: (number | null)[][] = Array.from({ length: n }, () => Array(n).fill(null));
      const frozen: boolean[][]       = Array.from({ length: n }, () => Array(n).fill(false));

      const key = (a: string, b: string) => `${a}|${b}`;
      const map = new Map<string, number>();
      for (const r of snapshot) map.set(key(r.base, r.quote), Number(r.value));

      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const A = coins[i], B = coins[j];
          const v = map.get(key(A, B));
          grid[i][j] = Number.isFinite(v as number) ? (v as number) : null;
          if (v == null) continue;
          const prev = await getPrevValue(t, A, B, ts);
          frozen[i][j] = Number.isFinite(prev) && prev === v;
        }
      }

      result.matrices[t] = grid;
      result.flags[t] = { frozen };
    }

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    console.error("[api] matrices/at error", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
