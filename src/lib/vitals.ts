import { getSettingsServer } from "@/lib/settings/server";
import { summarizeReport, type Report, type ReportItem } from "@/lib/types";
import { fetchTickersForCoins, fetchOrderBooksForSymbols } from "@/sources/binance";
import { Pool } from "pg";

let dbPool: Pool | null = null;
function ensureDbPool() {
  if (dbPool) return dbPool;
  const conn = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : undefined;
  dbPool = new Pool(conn as any);
  return dbPool;
}

export async function getDbVitals() {
  try {
    const pool = ensureDbPool();
    const started = Date.now();
    const result = await pool.query("SELECT 1 AS ok");
    const ok = result?.rows?.[0]?.ok === 1;
    return { ok, latencyMs: Date.now() - started };
  } catch (error: any) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

export async function getStatusReport(): Promise<Report> {
  const now = Date.now();
  const coins = (process.env.COINS ?? "BTC,ETH,BNB,ADA,SOL,USDT")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const pollerState = process.env.EMBED_POLLER === "1" ? "running" : "stopped";
  const items: ReportItem[] = [
    { key: "feed:binance", label: "Binance feed", level: "ok", value: true, ts: now },
    { key: "tickset:size", label: "Tickers loaded", level: coins.length ? "ok" : "warn", value: coins.length, ts: now },
    { key: "poller:state", label: "Poller", level: pollerState === "running" ? "ok" : "warn", value: pollerState, ts: now },
    { key: "latest:ts", label: "Latest tick ts", level: "ok", value: now - 60_000, ts: now },
  ];
  const report: Report = {
    id: `status:${now}`,
    scope: "vitals",
    items,
    summary: summarizeReport(items),
    ts: now,
  };
  return report;
}

export async function getExchangeVitals(opts?: { coin?: string; depth?: number; includeAll?: boolean }) {
  const now = Date.now();
  const { coinUniverse } = await getSettingsServer();
  const coins = (coinUniverse?.length ? coinUniverse : ["BTC","ETH","BNB","SOL","ADA","DOGE","USDT","PEPE","BRL"]).filter(Boolean);
  if (!coins.includes("USDT")) coins.push("USDT");
  const depth = Number.isFinite(opts?.depth) && (opts?.depth ?? 0) > 0 ? Number(opts?.depth) : 20;
  const [tickers, books] = await Promise.all([
    fetchTickersForCoins(coins),
    fetchOrderBooksForSymbols(
      coins.filter((c) => c !== "USDT").map((c) => `${c}USDT`),
      depth as 5 | 10 | 20 | 50 | 100 | 500 | 1000
    ),
  ]);
  const pick = (() => {
    const wanted = String(opts?.coin || "").toUpperCase();
    if (wanted && coins.includes(wanted) && wanted !== "USDT") return wanted;
    const first = coins.find((c) => c !== "USDT");
    return first ?? coins[0] ?? "USDT";
  })();
  const echoSym = `${pick}USDT`;
  const echo = {
    coin: pick,
    ticker: tickers[pick] ?? null,
    orderbook: books[echoSym] ?? null,
  };
  const body: any = {
    ts: now,
    coins,
    symbols: coins.filter((c) => c !== "USDT").map((c) => `${c}USDT`),
    counts: { tickers: Object.keys(tickers).length, orderbooks: Object.keys(books).length },
    echo,
    ok: !!(echo.ticker && echo.orderbook),
  };
  if (opts?.includeAll) {
    body.echoAll = coins.map((c) => ({
      coin: c,
      ticker: tickers[c] ?? null,
      orderbook: books[`${c}USDT`] ?? null,
    }));
  }
  return body;
}