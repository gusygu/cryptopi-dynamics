import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import { compileRoutes } from "@/auxiliary/cin-aux/flow/compiler";
import { runRoutes } from "@/auxiliary/cin-aux/flow/coordinator";
import { buildCinAuxForCycle, persistCinAux } from "@/auxiliary/cin-aux/buildCinAux";

const APP_SESSION = process.env.NEXT_PUBLIC_APP_SESSION_ID || "dev-session";

export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.searchParams;
    const appSessionId = (qs.get("appSessionId") || APP_SESSION).slice(0, 64);
    const cycleTs = Number(qs.get("cycleTs") || "");
    if (!Number.isFinite(cycleTs) || cycleTs <= 0) {
      return NextResponse.json({ ok: false, error: "cycleTs required (epoch ms)" }, { status: 400 });
    }

    await db.query(`insert into cycles(cycle_ts) values ($1) on conflict do nothing`, [cycleTs]);

    const intents = await compileRoutes(db, appSessionId, cycleTs);
    await runRoutes(db, intents);

    const rows = await buildCinAuxForCycle(db, appSessionId, cycleTs);
    await persistCinAux(db, rows);

    return NextResponse.json({
      ok: true,
      cycleTs,
      compiled: intents.length,
      cinRows: rows.length
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
