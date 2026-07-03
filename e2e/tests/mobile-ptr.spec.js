import { test, expect } from "@playwright/test";
import {
  disableServiceWorker,
  clearAppStorage,
  loginViaDeepLink,
  waitForDashboardData,
  pullToRefresh,
} from "../helpers.js";

test.describe("Pull-to-refresh", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await disableServiceWorker(page);
    await page.goto("/");
    await clearAppStorage(page);
    await loginViaDeepLink(page);
    await waitForDashboardData(page);
  });

  test("triggers refresh indicator on mobile pull gesture", async ({ page }) => {
    let dataRequestCount = 0;
    await page.route("**/api/systems/*/data", async (route) => {
      dataRequestCount += 1;
      await route.continue();
    });

    await pullToRefresh(page);

    await expect(page.locator("#ptr.refreshing, #ptr.armed, #ptr.pulling")).toBeVisible({
      timeout: 5000,
    });

    await expect.poll(() => dataRequestCount, { timeout: 10_000 }).toBeGreaterThan(0);
  });
});
