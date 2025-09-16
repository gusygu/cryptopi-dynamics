// src/app/api/str-aux/route.ts
import { NextResponse } from "next/server";
import { runStrAux } from "@/str-aux/run";
import { computeShiftSwap } from "@/str-aux/shift_swap";

// helper: parse CSV coins
function parseCoins(qs: URLSearchParams): string[] | null {
  const raw = qs.get("coins");
  if (!raw) return null;
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const qs = new URL(req.url).searchParams;

    // settings personalization (all optional)
    const coins = parseCoins(qs) ?? undefined;
    const epsilon = Number(qs.get("epsilon") ?? NaN);
    const loopMs = Number(qs.get("loopMs") ?? NaN) || undefined;
    const secondaryMs =
      Number(qs.get("secondaryMs") ?? NaN) ||
      Number(process.env.SECONDARY_LOOP_MS ?? 2500);
    const sessionStamp =
      qs.get("sessionStamp") ||
      qs.get("appSessionId") ||
      "default-session";

    // Run your existing snapshot builder (source of gfm_delta_pct & id_pct)
    // If runStrAux doesn't accept options, it will ignore them harmlessly.
    // @ts-ignore for signature flexibility
    const base = await runStrAux({ coins, sessionStamp });

    // Extract current metrics (fallback to 0 if absent)
    const gfm_delta_pct = Number(base?.gfm_delta_pct ?? 0);
    const id_pct        = Number(base?.id_pct ?? 0);

    // Compute shift/swap overlays (session-scoped counters + hh:mm:ss)
    const overlay = computeShiftSwap(sessionStamp, {
      gfm_delta_pct,
      id_pct,
      epsilon: Number.isFinite(epsilon) ? epsilon : Number(process.env.STR_EPSILON ?? 0.001),
      secondaryMs,
    });

    const payload = {
      ok: true,
      ...base,       // preserve your original shape
      ...overlay,    // add: shift_stamp, shift_n, shift_hms, swap_n, swap_sign, swap_hms
      meta: {
        ...(base?.meta ?? {}),
        coins,
        epsilon: Number.isFinite(epsilon) ? epsilon : undefined,
        secondaryMs,
        loopMs,
        sessionStamp,
      },
    };

    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
