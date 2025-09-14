// /src/app/api/converter/vm/route.ts
import { NextRequest, NextResponse } from "next/server";

/* ----------------------------- helpers ----------------------------- */

function parseCsv(q?: string | null): string[] {
  return (q ?? "")
    .split(",")
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
}

function getOrigin(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

function safeCell(
  g: number[][] | undefined,
  coins: string[] | undefined,
  a: string | undefined,
  b: string | undefined
): number {
  if (!g || !coins || !a || !b) return 0;
  const i = coins.indexOf(a);
  const j = coins.indexOf(b);
  if (i < 0 || j < 0) return 0;
  const v = g[i]?.[j];
  return Number.isFinite(v) ? Number(v) : 0;
}

function abs(x: number) { return Math.abs(Number(x) || 0); }

function meaTier(value: number): string {
  const v = abs(value);
  if (v >= 0.05) return "S";
  if (v >= 0.02) return "A";
  if (v >= 0.01) return "B";
  if (v >= 0.005) return "C";
  if (v >= 0.001) return "D";
  return "E";
}

type MatResp = {
  ok?: boolean;
  coins?: string[];
  matrices?: Partial<{
    benchmark: number[][];
    id_pct: number[][];
    pct_drv: number[][];
  }>;
};

type MeaResp = { ok?: boolean; grid?: number[][]; tier?: string; tierLabel?: string };

type SettingsResp = {
  ok?: boolean;
  wallets?: Record<string, number>;
  coinUniverse?: string[];
};

type SwapDirection = "up" | "down" | "frozen";
type SwapTag = { count: number; direction: SwapDirection; changedAtIso?: string };
const frozenSwap = (): SwapTag => ({ count: 0, direction: "frozen" });

/* -------------------------------- route ------------------------------- */

export async function GET(req: NextRequest) {
  const origin = getOrigin(req);
  const url = req.nextUrl;

  const Ca = (url.searchParams.get("Ca") || "").toUpperCase();
  const Cb = (url.searchParams.get("Cb") || "").toUpperCase();

  // Universe
  const coinsParam = parseCsv(url.searchParams.get("coins"));
  const envCoins = (process.env.NEXT_PUBLIC_COINS ?? "BTC,ETH,BNB,SOL,ADA,XRP,PEPE,USDT")
    .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  const coins = coinsParam.length ? coinsParam : envCoins;

  // Candidates (limited to universe and excluding Ca/Cb)
  const candParam = parseCsv(url.searchParams.get("candidates"));
  const candidatesRaw = candParam.length ? candParam : coins;
  const candidates = candidatesRaw
    .filter(c => coins.includes(c))
    .filter(c => c !== Ca && c !== Cb)
    .slice(0, 32);

  try {
    // parallel internal fetches
    const [matR, meaR, setR] = await Promise.all([
      fetch(`${origin}/api/matrices/latest?coins=${encodeURIComponent(coins.join(","))}&t=${Date.now()}`, { cache: "no-store" })
        .then(r => r.json() as Promise<MatResp>),
      fetch(`${origin}/api/mea-aux?coins=${encodeURIComponent(coins.join(","))}&t=${Date.now()}`, { cache: "no-store" })
        .then(r => r.json() as Promise<MeaResp>).catch(() => ({ ok: false } as MeaResp)),
      fetch(`${origin}/api/settings`, { cache: "no-store" })
        .then(r => r.json() as Promise<SettingsResp>).catch(() => ({ ok: false } as SettingsResp)),
    ]);

    const benchmark = matR?.matrices?.benchmark ?? [];
    const id_pct    = matR?.matrices?.id_pct    ?? [];
    const pct_drv   = matR?.matrices?.pct_drv   ?? [];
    const meaGrid   = meaR?.grid                ?? [];

    const wallets = setR?.wallets ?? {};

    // MEA panel value for selected pair (if provided)
    const meaValue = Ca && Cb ? safeCell(meaGrid, coins, Ca, Cb) : 0;
    const tier = (meaR?.tierLabel ?? meaR?.tier) || meaTier(meaValue);

    // ---------- build arbitrage rows (max 5) ----------
    type EdgeMetrics = { benchmark: number; id_pct: number; vTendency?: number; swapTag: SwapTag };
    type Row = { ci: string; cols: { cb_ci: EdgeMetrics; ci_ca: EdgeMetrics; ca_ci: EdgeMetrics } };

    const rows: Row[] = candidates.slice(0, 5).map((Ci) => {
      const drvOrId = (a: string, b: string) => {
        const d = safeCell(pct_drv, coins, a, b);
        return d !== 0 ? d : safeCell(id_pct, coins, a, b);
      };

      const cb_ci: EdgeMetrics = {
        benchmark: safeCell(benchmark, coins, Cb, Ci),
        id_pct:    safeCell(id_pct,    coins, Cb, Ci),
        vTendency: drvOrId(Cb, Ci),
        swapTag:   frozenSwap(),
      };
      const ci_ca: EdgeMetrics = {
        benchmark: safeCell(benchmark, coins, Ci, Ca),
        id_pct:    safeCell(id_pct,    coins, Ci, Ca),
        vTendency: drvOrId(Ci, Ca),
        swapTag:   frozenSwap(),
      };
      const ca_ci: EdgeMetrics = {
        benchmark: safeCell(benchmark, coins, Ca, Ci),
        id_pct:    safeCell(id_pct,    coins, Ca, Ci),
        vTendency: drvOrId(Ca, Ci),
        swapTag:   frozenSwap(),
      };

      return { ci: Ci, cols: { cb_ci, ci_ca, ca_ci } };
    });

    // ---------- Compose VM ----------
    const vm = {
      Ca, Cb,
      coins,
      wallets,
      matrix: {
        benchmark,
        id_pct,
        pct_drv,
        mea: meaGrid, // ← expose MEA to the client
      },
      panels: {
        mea: { value: meaValue, tier },
      },
      rows, // for ArbTable
    };

    return NextResponse.json({ ok: true, vm }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "converter/vm failed" }, { status: 500 });
  }
}
