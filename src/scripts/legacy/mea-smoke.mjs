// scripts/smoke/mea-smoke.mjs
import http from "node:http";

const host = process.env.APP_HOST ?? "localhost";
const port = process.env.APP_PORT ?? "3000";
const coins = process.env.COINS ?? "BTC,ETH,USDT";
const k = process.env.K ?? "2";
const url = `http://${host}:${port}/api/mea-aux?coins=${encodeURIComponent(coins)}&k=${k}`;

http.get(url, res => {
  let buf = "";
  res.on("data", d => buf += d);
  res.on("end", () => {
    try {
      const j = JSON.parse(buf);
      const { grid, meta } = j;
      console.log("== mea_aux smoke ==");
      const rows = Object.entries(grid).map(([base, row]) => ({ BASE: base, ...row }));
      console.table(rows);
      if (meta?.warnings?.length) console.warn("warnings:", meta.warnings);
      process.exit(0);
    } catch (e) {
      console.error("bad JSON:", e, buf);
      process.exit(1);
    }
  });
}).on("error", e => {
  console.error("HTTP error:", e.message);
  process.exit(1);
});
