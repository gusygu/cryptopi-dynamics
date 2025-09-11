import { NextRequest, NextResponse } from "next/server";
import { getAll as getSettings } from "@/lib/settings/server";
import { db } from "@/core/db";
import { buildCinAuxForCycle, persistCinAux } from "@/auxiliary/cin-aux/buildCinAux";

const APP_SESSION = process.env.NEXT_PUBLIC_APP_SESSION_ID || "dev-session";
const norm = (s: string) => String(s || "").trim().toUpperCase();
const uniq = (a: string[]) => Array.from(new Set(a.filter(Boolean)));

function coinsFrom(q: URLSearchParams, settingsCoins: string[]) {
  const qCoins = (q.get("coins") || "").split(/[,\s]+/).map(norm).filter(Boolean);
  return (qCoins.length ? qCoins : uniq(settingsCoins.map(norm)));
}

export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.searchParams;
    const cycleTs = Number(qs.get("cycleTs") || "");
    if (!Number.isFinite(cycleTs) || cycleTs <= 0) {
      return NextResponse.json({ ok: false, error: "cycleTs required (epoch ms)" }, { status: 400 });
    }
    const settings = await getSettings();
    const coins = coinsFrom(qs, settings.coinUniverse ?? []);
    const appSessionId = (qs.get("appSessionId") || APP_SESSION).slice(0, 64);

    // compute + persist CIN rows for that cycle
    const rows = await buildCinAuxForCycle(db, appSessionId, cycleTs);
    await persistCinAux(db, rows);

    // Return view-ready payload; UI can also hit /api/cin-aux afterwards
    return NextResponse.json({ ok: true, cycleTs, coins, persisted: rows.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
