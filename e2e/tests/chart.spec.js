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

  test("week strip shows seven day pills and prev navigates to prior day", async ({ page }) => {
    await expect(page.locator(".chart-day-pill")).toHaveCount(7);

    const activeDate = await page.locator(".chart-day-pill.active").getAttribute("data-date");
    expect(activeDate).toBeTruthy();

    await page.locator("#chart-prev-day").click();
    await expect(page.locator("#chart-loading")).toBeHidden();
    await expect(page.locator("#chart-date")).not.toHaveValue(activeDate);

    const prevDate = await page.locator(".chart-day-pill.active").getAttribute("data-date");
    expect(prevDate).not.toBe(activeDate);
    await expect(page.locator("#power-chart")).toBeVisible();
  });

  test("clicking a week strip day loads that date and persists in localStorage", async ({ page }) => {
    const target = page.locator('.chart-day-pill[data-date="2026-07-01"]');
    await target.click();

    await expect(page.locator("#chart-date")).toHaveValue("2026-07-01");
    await expect(page.locator('.chart-day-pill[data-date="2026-07-01"]')).toHaveClass(/active/);
    await expect(page.locator("#power-chart")).toBeVisible();

    await switchView(page, "cards");
    await switchView(page, "chart");

    await expect(page.locator("#chart-date")).toHaveValue("2026-07-01");
    await expect(page.locator('.chart-day-pill[data-date="2026-07-01"]')).toHaveClass(/active/);
  });

  test("summary request includes end= aligned to selected chart date", async ({ page }) => {
    const summaryRequests = [];
    page.on("request", (req) => {
      if (req.url().includes("/history/summary")) summaryRequests.push(req.url());
    });

    await page.locator('.chart-day-pill[data-date="2026-07-02"]').click();
    await expect(page.locator("#energy-chart")).toBeVisible();

    expect(summaryRequests.some((url) => url.includes("end=2026-07-02"))).toBe(true);
  });
});
