import { test, expect } from "@playwright/test";
import {
  disableServiceWorker,
  clearAppStorage,
  loginViaDeepLink,
  waitForHomeData,
  enterSystemDetail,
  waitForDashboardData,
} from "../helpers.js";

test.describe("Poll interval settings", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
    await disableServiceWorker(page);
    await page.goto("/");
    await clearAppStorage(page);
    await loginViaDeepLink(page);
    await waitForHomeData(page);
  });

  test("shows interval selector with 30/60/120 options in manage modal", async ({ page }) => {
    await page.locator("#manage-btn").click();
    await expect(page.locator("#manage-modal")).toBeVisible();

    const select = page.locator("#poll-interval");
    await expect(select).toBeVisible();
    await expect(select.locator("option")).toHaveCount(3);

    const values = await select.locator("option").evaluateAll((opts) => opts.map((o) => o.value));
    expect(values).toEqual(["30", "60", "120"]);
    await expect(select).toHaveValue("60");
  });

  test("persists selected interval across page reload", async ({ page }) => {
    await page.locator("#manage-btn").click();
    await page.locator("#poll-interval").selectOption("120");

    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("solar_poll_interval")))
      .toBe("120");

    await page.reload();
    await waitForHomeData(page);
    await page.locator("#manage-btn").click();
    await expect(page.locator("#poll-interval")).toHaveValue("120");
  });

  test("restarts polling timer when interval changes", async ({ page }) => {
    await enterSystemDetail(page, "Mock Cabin", { view: "cards" });

    let dataRequestCount = 0;
    await page.route("**/api/systems/*/data", async (route) => {
      dataRequestCount += 1;
      await route.continue();
    });

    await waitForDashboardData(page);
    const countAfterLoad = dataRequestCount;

    await page.locator("#manage-btn").click();
    await page.locator("#poll-interval").selectOption("30");
    await page.locator("#manage-close").click();

    await expect.poll(() => dataRequestCount, { timeout: 5_000 }).toBeGreaterThan(countAfterLoad);
    const countAfterRestart = dataRequestCount;

    await page.clock.fastForward(30_000);
    await expect.poll(() => dataRequestCount, { timeout: 5_000 }).toBeGreaterThan(countAfterRestart);
  });
});
