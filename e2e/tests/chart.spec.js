import { test, expect } from "@playwright/test";
import {
  disableServiceWorker,
  clearAppStorage,
  loginViaDeepLink,
  waitForDashboardData,
  switchView,
  EMPTY_HISTORY_DATE,
} from "../helpers.js";

test.beforeEach(async ({ page }) => {
  await disableServiceWorker(page);
  await page.goto("/");
  await clearAppStorage(page);
  await loginViaDeepLink(page);
  await waitForDashboardData(page);
  await switchView(page, "chart");
});

test.describe("Chart view", () => {
  test("renders intraday canvas and energy summary with mock history", async ({ page }) => {
    await expect(page.locator("#chart-view")).toBeVisible();
    await expect(page.locator("#power-chart")).toBeVisible();
    await expect(page.locator("#chart-empty")).toBeHidden();
    await expect(page.locator("#energy-chart")).toBeVisible();
    await expect(page.locator("#energy-empty")).toBeHidden();
    await expect(page.locator("#chart-export-btn")).toBeEnabled();
  });

  test("shows empty state when vendor returns no points", async ({ page }) => {
    await page.locator("#chart-date").fill(EMPTY_HISTORY_DATE);
    await page.locator("#chart-date").dispatchEvent("change");

    await expect(page.locator("#power-chart")).toBeHidden();
    await expect(page.locator("#chart-empty")).toBeVisible();
    await expect(page.locator("#chart-empty-msg")).toContainText(/no power data/i);
    await expect(page.locator("#chart-export-btn")).toBeDisabled();
  });

  test("loads history again after switching back to a data day", async ({ page }) => {
    await page.locator("#chart-date").fill(EMPTY_HISTORY_DATE);
    await page.locator("#chart-date").dispatchEvent("change");
    await expect(page.locator("#chart-empty")).toBeVisible();

    await page.locator("#chart-date").fill("2026-07-03");
    await page.locator("#chart-date").dispatchEvent("change");

    await expect(page.locator("#power-chart")).toBeVisible();
    await expect(page.locator("#chart-empty")).toBeHidden();
  });
});
