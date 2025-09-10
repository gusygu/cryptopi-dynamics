// src/app/api/converter/vm/route.ts
import "@/app/(server)/wire-converter"; // <-- IMPORTANT: wires providers once
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

    const universe =
      (coinsParam
        ? coinsParam.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean)
        : s.coinUniverse) || ["BTC", "ETH", "BNB", "SOL", "USDT"];

    const candidates =
      (candidatesParam
        ? candidatesParam.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean)
        : s.clustering?.clusters?.[0]?.coins) || universe.slice(0, 3);

    const histLen = Math.max(16, Number(s.stats?.histogramLen ?? 64));

    const vm = await buildDomainVM({
      Ca,
      Cb,
      coinsUniverse: universe,
      candidates,
      histLen,
    });

    return NextResponse.json(vm);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unexpected error" },
      { status: 500 }
    );
  }
}
