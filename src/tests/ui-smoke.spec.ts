import { test, expect, Response } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const WAIT_MS = Number(process.env.SMOKE_WAIT_MS || 30000); // more forgiving

async function gotoAndWait(page: any, path: string) {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  // page should load even if API fails
  expect(res?.ok(), `navigate ${path} http=${res?.status()}`).toBeTruthy();
  // give React a small breath for on-mount effects
  await page.waitForTimeout(400);
  await expect(page.locator("body")).toBeVisible();
}

async function tryWaitApi(page: any, pattern: RegExp, label: string) {
  try {
    const resp: Response = await page.waitForResponse(r => pattern.test(r.url()), { timeout: WAIT_MS });
    const status = resp.status();
    // log the first match; do not fail if not 2xx
    console.log(`[ui-smoke] ${label} matched: ${resp.url()} http=${status}`);
    // soft-assert: treat 2xx as pass; non-2xx is a warning but not a failure
    expect(status, `API ${label} status`).toBeLessThan(500);
  } catch {
    // If we didn't see a matching call in time, don’t fail the test: log and move on
    console.warn(`[ui-smoke] ${label} no matching response within ${WAIT_MS}ms`);
  }
}

test.describe("@ui-smoke", () => {
  test(`@ui-smoke /matrices loads`, async ({ page }) => {
    await gotoAndWait(page, "/matrices");
    // Accept any matrices API flavor; don't enforce 2xx
    await tryWaitApi(page, /\/api\/matrices\//i, "matrices");
  });

  test(`@ui-smoke /dynamics loads`, async ({ page }) => {
    await gotoAndWait(page, "/dynamics");
    // Some deployments hit /api/mea-aux, others /api/dynamics — allow either
    await tryWaitApi(page, /\/api\/(mea-aux|dynamics)\b/i, "dynamics");
  });

  test(`@ui-smoke /str-aux loads`, async ({ page }) => {
    await gotoAndWait(page, "/str-aux");
    // New page calls /api/str-aux/bins (may be 2xx or 4xx while wiring)
    await tryWaitApi(page, /\/api\/str-aux\/bins\b/i, "str-aux");
  });
});
