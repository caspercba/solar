import { expect } from "@playwright/test";
import { MOCK_TOKEN, EMPTY_HISTORY_DATE } from "./fixtures/payloads.js";

export const MOCK_WORKER_PORT = Number(process.env.MOCK_WORKER_PORT) || 8790;
export const FRONTEND_PORT = Number(process.env.FRONTEND_PORT) || 3456;
export const MOCK_WORKER_URL = `http://127.0.0.1:${MOCK_WORKER_PORT}`;
export { MOCK_TOKEN, EMPTY_HISTORY_DATE };

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
  const tabId = view === "flow" ? "#tab-flow" : view === "chart" ? "#tab-chart" : "#tab-cards";
  await page.locator(tabId).click();
}

export async function pullToRefresh(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await page.locator("#dashboard-screen").boundingBox();
  if (!box) throw new Error("dashboard-screen not visible");
  const x = box.x + box.width / 2;
  const startY = box.y + 80;
  const endY = startY + 120;

  await page.evaluate(({ x, startY, endY }) => {
    const dash = document.getElementById("dashboard-screen");
    const mk = (clientY) =>
      new Touch({
        identifier: 0,
        target: dash,
        clientX: x,
        clientY,
        pageX: x,
        pageY: clientY,
        screenX: x,
        screenY: clientY,
        radiusX: 1,
        radiusY: 1,
        rotationAngle: 0,
        force: 1,
      });
    const start = mk(startY);
    const end = mk(endY);
    dash.dispatchEvent(
      new TouchEvent("touchstart", {
        bubbles: true,
        cancelable: true,
        touches: [start],
        targetTouches: [start],
        changedTouches: [start],
      }),
    );
    dash.dispatchEvent(
      new TouchEvent("touchmove", {
        bubbles: true,
        cancelable: true,
        touches: [end],
        targetTouches: [end],
        changedTouches: [end],
      }),
    );
    dash.dispatchEvent(
      new TouchEvent("touchend", {
        bubbles: true,
        cancelable: true,
        touches: [],
        targetTouches: [],
        changedTouches: [end],
      }),
    );
  }, { x, startY, endY });
}
