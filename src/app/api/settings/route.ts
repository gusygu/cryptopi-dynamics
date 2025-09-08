// src/app/api/settings/route.ts
import { NextResponse } from "next/server";
import { migrateSettings } from "@/lib/settings/schema";

// 1 year
const MAX_AGE = 60 * 60 * 24 * 365;
const COOKIE = "appSettings";

export async function GET() {
  return NextResponse.json({ ok: true, settings: await readCookie() });
}

export async function POST(req: Request) {
  try {
    const { settings } = (await req.json()) as { settings: unknown };
    const clean = migrateSettings(settings);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE, JSON.stringify(clean), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: MAX_AGE,
    });
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "invalid payload" }, { status: 400 });
  }
}

async function readCookie() {
  // We cannot read cookies here without a Request; this GET returns just for client hydration via Next
  // Actual server usage below in getSettingsServer()
  return null;
}
