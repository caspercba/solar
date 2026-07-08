import { expect } from "@playwright/test";
import { MOCK_TOKEN, EMPTY_HISTORY_DATE, ESTIMATED_SOC_HISTORY_DATE } from "./fixtures/payloads.js";

export const MOCK_WORKER_PORT = Number(process.env.MOCK_WORKER_PORT) || 8790;
export const FRONTEND_PORT = Number(process.env.FRONTEND_PORT) || 3456;
export const MOCK_WORKER_URL = `http://127.0.0.1:${MOCK_WORKER_PORT}`;
export { MOCK_TOKEN, EMPTY_HISTORY_DATE, ESTIMATED_SOC_HISTORY_DATE };

/** ISO date N days before today (local calendar), for asserting against the chart week strip. */
export function isoDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Avoid stale service-worker caches interfering with static assets in tests. */
export async function disableServiceWorker(page) {
  await page.addInitScript(() => {
    if (!navigator.serviceWorker) return;
    navigator.serviceWorker.register = () =>
      Promise.reject(new Error("service worker disabled in e2e"));
  });
}

export async function clearAppStorage(page) {
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

export async function loginViaDeepLink(page, token = MOCK_TOKEN) {
  const proxy = encodeURIComponent(MOCK_WORKER_URL);
  const tok = encodeURIComponent(token);
  await page.goto(`/?proxy=${proxy}&token=${tok}`);
  await expect(page.locator("#dashboard-screen")).toBeVisible();
}

export async function loginViaSetupForm(page, { url = MOCK_WORKER_URL, token = MOCK_TOKEN } = {}) {
  await page.goto("/");
  await expect(page.locator("#setup-screen")).toBeVisible();
  await page.locator("#setup-url").fill(url);
  await page.locator("#setup-token").fill(token);
  await page.locator("#setup-btn").click();
}

export async function waitForDashboardData(page) {
  await expect(page.locator("#bat-pct")).not.toHaveText("--");
  await expect(page.locator("#bat-pct")).not.toHaveClass(/skeleton/);
}

export async function switchView(page, view) {
  const tabId = view === "flow"
    ? "#tab-flow"
    : view === "chart"
      ? "#tab-chart"
      : view === "compare"
        ? "#tab-compare"
        : "#tab-cards";
  await page.locator(tabId).click();
}

/** Simulate a horizontal swipe on the chart area (requires hasTouch / mobile project). */
export async function swipeChartDay(page, { direction = "prev", distance = 120 } = {}) {
  const area = page.locator("#chart-swipe-area");
  const box = await area.boundingBox();
  if (!box) throw new Error("chart-swipe-area not visible");
  const y = Math.round(box.y + box.height / 2);
  const centerX = Math.round(box.x + box.width / 2);
  const endX = direction === "prev" ? centerX + distance : centerX - distance;

  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: x == null ? [] : [{ x, y }],
    });

  await touch("touchStart", centerX);
  for (let x = centerX; direction === "prev" ? x <= endX : x >= endX; x += direction === "prev" ? 10 : -10) {
    await touch("touchMove", x);
  }
  await touch("touchEnd");
}

export async function waitForCompareData(page) {
  await expect(page.locator("#compare-view")).toBeVisible();
  await expect(page.locator(".compare-card").first()).not.toHaveClass(/skeleton/);
  await expect(page.locator(".compare-card .compare-value").first()).not.toHaveText("--%");
}

/** Simulate a downward pull on the dashboard (requires hasTouch / mobile project). */
export async function pullToRefresh(page, { pullDistance = 120 } = {}) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await page.locator("#dashboard-screen").boundingBox();
  if (!box) throw new Error("dashboard-screen not visible");
  const x = Math.round(box.x + box.width / 2);
  const startY = Math.round(box.y + 80);
  const endY = startY + pullDistance;

  const cdp = await page.context().newCDPSession(page);
  const touch = (type, y) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: y == null ? [] : [{ x, y }],
    });

  await touch("touchStart", startY);
  for (let y = startY + 10; y <= endY; y += 10) {
    await touch("touchMove", y);
  }
  await touch("touchEnd");
}
