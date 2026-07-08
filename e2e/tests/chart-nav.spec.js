import { test, expect } from "@playwright/test";
import {
  disableServiceWorker,
  clearAppStorage,
  loginViaDeepLink,
  waitForDashboardData,
  switchView,
  swipeChartDay,
} from "../helpers.js";

const CHART_DATE_KEY = "solar_chart_date";

test.beforeEach(async ({ page }) => {
  await disableServiceWorker(page);
  await page.goto("/");
  await clearAppStorage(page);
  await loginViaDeepLink(page);
  await waitForDashboardData(page);
  await switchView(page, "chart");
  await expect(page.locator("#chart-loading")).toBeHidden();
});

test.describe("Chart multi-day navigation — desktop", () => {
  test("prev/next buttons step through 7 past days with vendor history fetch", async ({ page }) => {
    await page.route("**/api/systems/*/history?*", async (route) => {
      await new Promise((r) => setTimeout(r, 150));
      await route.continue();
    });

    const historyRequests = [];
    page.on("request", (req) => {
      const url = req.url();
      if (/\/history\?/.test(url) && !url.includes("/summary")) {
        historyRequests.push(url);
      }
    });

    const startDate = await page.locator("#chart-date").inputValue();
    let current = startDate;

    for (let i = 0; i < 7; i++) {
      const prevCount = historyRequests.length;
      await page.locator("#chart-prev").click();
      await expect(page.locator("#chart-loading")).toBeVisible();
      await expect(page.locator("#chart-loading")).toBeHidden();
      expect(historyRequests.length).toBeGreaterThan(prevCount);

      const nextDate = await page.locator("#chart-date").inputValue();
      expect(nextDate).not.toBe(current);
      current = nextDate;
    }

    await expect(page.locator("#power-chart")).toBeVisible();
  });

  test("week strip day buttons load history without full page reload", async ({ page }) => {
    await expect(page.locator("#chart-week-strip")).toBeVisible();
    await expect(page.locator("#chart-week-strip .chart-day-btn")).toHaveCount(7);

    const historyRequests = [];
    page.on("request", (req) => {
      const url = req.url();
      if (/\/history\?/.test(url) && !url.includes("/summary")) {
        historyRequests.push(url);
      }
    });

    const initialCount = historyRequests.length;
    const target = page.locator('#chart-week-strip .chart-day-btn[data-date="2026-07-01"]');
    await target.click();

    await expect(page.locator("#chart-loading")).toBeHidden();
    await expect(page.locator("#chart-date")).toHaveValue("2026-07-01");
    await expect(page.locator("#power-chart")).toBeVisible();
    expect(historyRequests.length).toBeGreaterThan(initialCount);
    expect(historyRequests.some((url) => url.includes("date=2026-07-01"))).toBe(true);
  });

  test("persists last viewed chart date in localStorage", async ({ page }) => {
    await page.locator("#chart-prev").click();
    await expect(page.locator("#chart-loading")).toBeHidden();

    const storedDate = await page.locator("#chart-date").inputValue();
    expect(storedDate).toBeTruthy();

    const stored = await page.evaluate((key) => localStorage.getItem(key), CHART_DATE_KEY);
    expect(stored).toBe(storedDate);

    await switchView(page, "cards");
    await switchView(page, "chart");

    await expect(page.locator("#chart-date")).toHaveValue(storedDate);
    await expect(page.locator(`#chart-week-strip .chart-day-btn[data-date="${storedDate}"]`)).toHaveClass(/active/);
  });
});

test.describe("Chart multi-day navigation — mobile swipe", () => {
  test.use({ hasTouch: true });

  test("swipe right on chart area loads previous day", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome", "chart swipe is mobile-only");

    const activeDate = await page.locator("#chart-week-strip .chart-day-btn.active").getAttribute("data-date");
    expect(activeDate).toBeTruthy();

    await swipeChartDay(page, { direction: "prev" });

    await expect(page.locator("#chart-loading")).toBeHidden();
    await expect(page.locator("#chart-date")).not.toHaveValue(activeDate);
    await expect(page.locator("#power-chart")).toBeVisible();
  });
});
