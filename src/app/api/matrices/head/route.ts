import { NextRequest, NextResponse } from "next/server";
import { getAll as getSettings } from "@/lib/settings/server";
import {
  getLatestTsForType,
  countSnapshotByType,
  type MatrixType,
} from "@/core/db";

export const dynamic = "force-dynamic";

const TYPES: MatrixType[] = ["benchmark", "delta", "pct24h", "id_pct", "pct_drv"];

function parseCoins(req: NextRequest, fallback: string[]): string[] {
  const qs = req.nextUrl.searchParams.get("coins");
  if (!qs) return fallback;
  const arr = qs.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  return arr.length ? arr : fallback;
}

export async function GET(req: NextRequest) {
  try {
    const settings = await getSettings();
    // Use settings.coinUniverse; it’s the canonical source.
    const defCoins: string[] =
      Array.isArray((settings as any)?.coinUniverse) && (settings as any).coinUniverse.length
        ? (settings as any).coinUniverse.map((c: any) => String(c).toUpperCase())
        : ["BTC","ETH","BNB","SOL","ADA","XRP","PEPE","USDT"];

    const coins = parseCoins(req, defCoins);

    const ts: Record<MatrixType, number | null> = {
      benchmark: null, delta: null, pct24h: null, id_pct: null, pct_drv: null
    };
    const rows: Record<MatrixType, number> = {
      benchmark: 0, delta: 0, pct24h: 0, id_pct: 0, pct_drv: 0
    };

    for (const t of TYPES) {
      const latest = await getLatestTsForType(t);
      ts[t] = latest;
      if (latest != null) {
        rows[t] = await countSnapshotByType(t, latest, coins);
      }
    }

    return NextResponse.json({ ok: true, ts, rows, coins });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
