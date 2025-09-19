import { NextRequest, NextResponse } from "next/server";
import { buildLatestPayload } from "@/core/matricesLatest";
import { loadMatricesContext, parseCoinsParam } from "@/core/matrices/context";
import { fetchPreviewSymbolSet } from "@/core/matrices/preview";
import type { MatrixType } from "@/core/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

const TYPES: MatrixType[] = ["benchmark", "delta", "pct24h", "id_pct", "pct_drv"];

function coinsFromQuery(params?: URLSearchParams): string[] | undefined {
  if (!params) return;
  const raw = params.get("coins");
  if (!raw) return;
  const parsed = parseCoinsParam(raw);
  return parsed.length ? parsed : undefined;
}

export async function GET(req: NextRequest) {
  try {
    // Resolve coins + poller + settings from shared context
    const override = coinsFromQuery(req.nextUrl?.searchParams);
    const ctx = await loadMatricesContext({
      searchParams: req.nextUrl.searchParams,
      coinsOverride: override,
    });

    // Live preview symbols (used for rings/flags)
    const previewSet = await fetchPreviewSymbolSet(req.nextUrl.origin, ctx.coins);

    // Canonical payload
    const payload = await buildLatestPayload({
      coins: ctx.coins,
      previewSymbols: previewSet,
      settings: ctx.settings,
      poller: ctx.poller,
    });

    // Ensure legacy callers still see top-level matrices keys
    const body = {
      ...payload,
      benchmark: payload.matrices.benchmark ?? null,
      delta:     payload.matrices.delta     ?? null,
      pct24h:    payload.matrices.pct24h    ?? null,
      id_pct:    payload.matrices.id_pct    ?? null,
      pct_drv:   payload.matrices.pct_drv   ?? null,
      coinSource: ctx.coinSource,
      debug: {
        coinSource: ctx.coinSource,
        preview: previewSet ? `binance(${previewSet.size})` : "matrix",
      },
    };

    const res = NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
    // Diagnostics headers
    res.headers.set("x-coins-used", payload.coins.join(","));
    if (ctx.poller) res.headers.set("x-poller-ms", String(ctx.poller.baseMs));
    for (const t of TYPES) res.headers.set(`x-rows-${t}`, String(payload.rows?.[t] ?? 0));
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
