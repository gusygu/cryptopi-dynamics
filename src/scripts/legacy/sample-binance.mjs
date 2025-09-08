// Run: node src/scripts/sample-binance.mjs BTCUSDT 30m
// Requires your app running locally (default PORT 3000)

const symbol = process.argv[2] || "BTCUSDT";
const windowKey = process.argv[3] || "30m";
const base = symbol.replace(/USDT$/, "");
const quote = "USDT";

async function main() {
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`binance 24hr HTTP ${res.status}`);
  const t = await res.json();

  const pct24h = Number(t.priceChangePercent) / 100;
  const last = Number(t.lastPrice);
  const ts = Date.now();

  const body = {
    pair: { base, quote, window: windowKey, appSessionId: "dev-session" },
    opening: {
      benchmark: 1,
      pct24h,
      pct_drv: pct24h,
      ts,
      layoutHash: "binance-24h",
    },
    points: [
      { price: Number(t.lowPrice), volume: Number(t.volume || 0), ts: ts - 60_000 },
      { price: last, volume: Number(t.volume || 0), ts },
      { price: Number(t.highPrice), volume: Number(t.volume || 0), ts: ts + 60_000 },
    ],
    metrics: {
      benchmarkPrev: 1,
      benchmarkCur: 1,
      pct24hPrev: 0,
      pct24hCur: pct24h,
      idPctPrev: 0,
      idPctCur: pct24h,
    },
    latestTs: ts,
  };

  const ingestUrl = `http://localhost:${process.env.PORT || 3000}/api/str-aux/ingest`;

  const post = await fetch(ingestUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const raw = await post.text();
  const ctype = post.headers.get("content-type") || "";
  const out = ctype.includes("application/json")
    ? (() => {
        try {
          return JSON.parse(raw);
        } catch {
          return { _raw: raw };
        }
      })()
    : { _raw: raw };

  if (!post.ok) {
    console.error("ingest error:", {
      status: post.status,
      statusText: post.statusText,
      contentType: ctype,
      body: out,
    });
    process.exit(2);
  }

  console.log("ingested:", out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
