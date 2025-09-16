// src/app/api/pipeline/run-once/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAll as getSettings } from "@/lib/settings/server";
import { insertMatrixRows, type MatrixType } from "@/core/db";
import { buildLatestMatrices } from "@/core/matricesLatest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TYPES: MatrixType[] = ["benchmark", "delta", "pct24h", "id_pct", "pct_drv"];

function uniqUpper(list: string[] | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of list ?? []) {
    const u = String(x || "").trim().toUpperCase();
    if (u && !seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out;
}

function defaultCoins(): string[] {
  return ["BTC","ETH","BNB","SOL","ADA","PEPE","USDT","BRL"];
}

async function resolveCoins(req: NextRequest): Promise<string[]> {
  // Body coins (POST) → Query coins (GET) → Settings → Env → Defaults
  let bodyCoins: string[] = [];
  try {
    const b = await req.json();
    if (Array.isArray(b?.coins)) bodyCoins = b.coins;
  } catch { /* no body is fine */ }

  const qs = req.nextUrl.searchParams.get("coins");
  const queryCoins = qs ? qs.split(",") : [];

  const settings = await getSettings();
  const settingsCoins: string[] =
    Array.isArray((settings as any)?.coins) && (settings as any).coins.length
      ? (settings as any).coins
      : defaultCoins();

  const envCoins = process.env.NEXT_PUBLIC_COINS
    ? process.env.NEXT_PUBLIC_COINS.split(",")
    : [];

  return uniqUpper(
    bodyCoins.length ? bodyCoins :
    (queryCoins.length ? queryCoins :
    (envCoins.length ? envCoins : settingsCoins))
  );
}

export async function POST(req: NextRequest) {
  try {
    const coins = await resolveCoins(req);
    const ts_ms = Date.now();

    // Build matrices as row arrays (compile-safe path backed by latest snapshots)
    const mats = await buildLatestMatrices({ coins, ts_ms });

    const wrote: Record<MatrixType, number> = {
      benchmark: 0, delta: 0, pct24h: 0, id_pct: 0, pct_drv: 0
    };

    for (const t of TYPES) {
      const rows = (mats as any)[t] as Array<{ base:string; quote:string; value:number; meta?:Record<string,any> }>;
      if (rows?.length) {
        await insertMatrixRows(ts_ms, t, rows);
        wrote[t] = rows.length;
      }
    }

    return NextResponse.json({ ok: true, ts_ms, coins, wrote });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
