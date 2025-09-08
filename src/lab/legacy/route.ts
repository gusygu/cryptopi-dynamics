// src/app/api/str-aux/route.ts
export const runtime = "nodejs"; // ensure Node APIs

import { NextRequest, NextResponse } from "next/server";
import { buildStrAux } from "@/lab/str-aux/buildStrAux";
import { db } from "@/lib/str-aux/db";
import type { ComputePayload, WindowKey } from "@/lab/str-aux/types";

function jsonErr(status: number, message: string, detail?: unknown) {
  return NextResponse.json({ error: message, detail }, { status });
}

function isObj(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const base = (searchParams.get("base") || "BTC").toUpperCase();
    const quote = (searchParams.get("quote") || "USDT").toUpperCase();
    const window = (searchParams.get("window") || "30m") as WindowKey;
    const appSessionId = searchParams.get("appSessionId") || "dev-session";

    const prev = await db.getLatest({ base, quote, window, appSessionId });
    return NextResponse.json(prev ?? null, { status: 200 });
  } catch (e) {
    return jsonErr(500, "GET /api/str-aux failed", String(e));
  }
}

export async function POST(req: NextRequest) {
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch (e) {
      return jsonErr(400, "Body must be valid JSON", String(e));
    }

    if (!isObj(raw) || !isObj(raw.pair)) {
      return jsonErr(400, "Missing body.pair { base, quote, window }");
    }

    const pair = raw.pair as Record<string, unknown>;
    const base = typeof pair.base === "string" ? pair.base.toUpperCase() : null;
    const quote = typeof pair.quote === "string" ? pair.quote.toUpperCase() : null;
    const windowStr = typeof pair.window === "string" ? pair.window : null;
    const appSessionId =
      typeof pair.appSessionId === "string" && pair.appSessionId ? pair.appSessionId : "dev-session";

    if (!base || !quote || !windowStr) {
      return jsonErr(400, "pair.base, pair.quote, pair.window must be non-empty strings");
    }

    const safeWindow: WindowKey = (["30m", "1h", "3h"].includes(windowStr) ? windowStr : "30m") as WindowKey;

    const normalized: ComputePayload = {
      pair: { base, quote, window: safeWindow, appSessionId },
      opening: isObj(raw.opening) ? (raw.opening as any) : undefined,
      points: Array.isArray((raw as any).points) ? ((raw as any).points as any[]) : undefined,
      metrics: isObj((raw as any).metrics) ? ((raw as any).metrics as any) : undefined,
    };

    const prev = await db.getLatest({
      base: normalized.pair.base,
      quote: normalized.pair.quote,
      window: normalized.pair.window,
      appSessionId: normalized.pair.appSessionId!,
    });

    const doc = await buildStrAux(normalized, prev ?? undefined);
    await db.upsert(doc);
    return NextResponse.json(doc, { status: 200 });
  } catch (e: any) {
    return jsonErr(500, "POST /api/str-aux failed", e?.stack ?? String(e));
  }
}
