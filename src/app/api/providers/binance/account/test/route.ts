import { NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ReqBody = { apiKey?: string; apiSecret?: string };

export async function POST(req: Request) {
  try {
    const { apiKey, apiSecret } = (await req.json()) as ReqBody;

    if (!apiKey || !apiSecret) {
      return NextResponse.json({ ok: false, error: "Missing apiKey or apiSecret" }, { status: 400 });
    }

    const timestamp = Date.now();
    const query = new URLSearchParams({ timestamp: String(timestamp) }).toString();
    const signature = crypto.createHmac("sha256", apiSecret).update(query).digest("hex");

    const url = `https://api.binance.com/api/v3/account?${query}&signature=${signature}`;
    const res = await fetch(url, {
      headers: {
        "X-MBX-APIKEY": apiKey,
      },
      cache: "no-store",
    });

    const text = await res.text();
    let json: any = undefined;
    try { json = JSON.parse(text); } catch { /* noop */ }

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, status: res.status, error: json?.msg || text || "Request failed" },
        { status: 200 } // return 200 so UI can always parse
      );
    }

    const acct = json || {};
    return NextResponse.json({
      ok: true,
      accountType: acct.accountType ?? null,
      canTrade: !!acct.canTrade,
      balancesCount: Array.isArray(acct.balances) ? acct.balances.length : 0,
      updateTime: acct.updateTime ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unexpected error" }, { status: 200 });
  }
}
