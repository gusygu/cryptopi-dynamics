import { NextResponse } from "next/server";
import { Pool } from "pg";

export const dynamic = "force-dynamic";

let pool: Pool | null = null;
function getPool() {
  if (pool) return pool;
  const conn = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : undefined;
  pool = new Pool(conn as any);
  return pool;
}

export async function GET() {
  try {
    const p = getPool();
    const r = await p.query("SELECT 1 AS ok");
    const ok = r?.rows?.[0]?.ok === 1;
    return NextResponse.json({ ok }, { status: ok ? 200 : 500 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
