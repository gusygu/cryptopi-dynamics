// src/app/api/converter/vm/route.ts
import { NextResponse } from "next/server";
import { getSettingsServer } from "@/lib/settings/server";
import { buildDomainVM } from "@/converters/Converter.server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const Ca = (url.searchParams.get("Ca") || "ETH").toUpperCase();
    const Cb = (url.searchParams.get("Cb") || "USDT").toUpperCase();

    const coinsParam = url.searchParams.get("coins");
    const candidatesParam = url.searchParams.get("candidates");

    const s = await getSettingsServer();

    // Universe: explicit ?coins=… → else settings.coinUniverse → else minimal fallback
    const coinsUniverse =
      (coinsParam
        ? coinsParam
            .split(",")
            .map((x) => x.trim().toUpperCase())
            .filter(Boolean)
        : s.coinUniverse) || ["BTC", "ETH", "USDT"];

    // Candidates: explicit ?candidates=… → else Cluster 1 → else first few from universe
    const candidates =
      (candidatesParam
        ? candidatesParam
            .split(",")
            .map((x) => x.trim().toUpperCase())
            .filter(Boolean)
        : s.clustering?.clusters?.[0]?.coins) ||
      coinsUniverse.slice(0, 5);

    // Build VM — NOTE: do not pass `timing` here; BuildVMOpts doesn’t include it.
    // If timing is needed, the builder can read it with getSettingsServer() internally.
    const vm = await buildDomainVM({
      Ca,
      Cb,
      coinsUniverse,
      candidates,
    });

    return NextResponse.json(vm);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unexpected error" }, { status: 500 });
  }
}
