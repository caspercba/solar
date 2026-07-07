import { test, expect } from "@playwright/test";
import {
  disableServiceWorker,
  clearAppStorage,
  loginViaDeepLink,
  waitForDashboardData,
  switchView,
} from "../helpers.js";
import { MOCK_SYSTEM_ID_2 } from "../fixtures/payloads.js";

test.beforeEach(async ({ page }) => {
  await disableServiceWorker(page);
  await page.goto("/");
  await clearAppStorage(page);
  await loginViaDeepLink(page);
  await waitForDashboardData(page);
});

test.describe("Cards view", () => {
  test("renders mock SOC and watts", async ({ page }) => {
    await expect(page.locator("#cards-view")).toBeVisible();
    await expect(page.locator("#bat-pct")).toHaveText("72");
    await expect(page.locator("#bat-direction")).toHaveText("Charging");
    await expect(page.locator("#sol-watts")).toHaveText("1200");
    await expect(page.locator("#load-watts")).toHaveText("850");
    await expect(page.locator("#gen-status")).toHaveText("OFF");
    await expect(page.locator("#inverter-status")).toHaveText("PV Charging");
    await expect(page.locator("#bat-bar")).toHaveAttribute("style", /width:\s*72%/);
  });
});

test.describe("Flow view", () => {
  test("shows charging animation class for home system", async ({ page }) => {
    await switchView(page, "flow");

    await expect(page.locator("#flow-view")).toBeVisible();
    const batPath = page.locator("#fp-bat");
    await expect(batPath).toHaveClass(/charging/);
    await expect(batPath).not.toHaveClass(/discharging/);
    await expect(page.locator("#fn-bat-bg")).toHaveClass(/charging/);
  });

  test("shows discharging animation class when cabin system selected", async ({ page }) => {
    await page.locator("#system-tabs button", { hasText: "Mock Cabin" }).click();
    await waitForDashboardData(page);
    await switchView(page, "flow");

    const batPath = page.locator("#fp-bat");
    await expect(batPath).toHaveClass(/discharging/);
    await expect(page.locator("#fn-bat-bg")).toHaveClass(/discharging/);
  });
});

test.describe("System tabs", () => {
  test("shows tabs when two or more systems configured", async ({ page }) => {
    const tabs = page.locator("#system-tabs .sys-tab");
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(0)).toHaveText("Mock Home Solar");
    await expect(tabs.nth(1)).toHaveText("Mock Cabin");
    await expect(tabs.nth(0)).toHaveClass(/active/);
  });

  test("switches active system and reloads data", async ({ page }) => {
    await page.locator("#system-tabs button", { hasText: "Mock Cabin" }).click();
    await waitForDashboardData(page);

    await expect(page.locator("#bat-pct")).toHaveText("45");
    await expect(page.locator("#bat-direction")).toHaveText("Discharging");
    await expect(page.locator("#system-tabs .sys-tab.active")).toHaveText("Mock Cabin");

    const activeId = await page.evaluate(() => localStorage.getItem("solar_active"));
    expect(activeId).toBe(MOCK_SYSTEM_ID_2);
  });

  test("restores active system from localStorage on reload", async ({ page }) => {
    await page.locator("#system-tabs button", { hasText: "Mock Cabin" }).click();
    await waitForDashboardData(page);

    await page.reload();
    await expect(page.locator("#dashboard-screen")).toBeVisible();
    await waitForDashboardData(page);

    await expect(page.locator("#system-tabs .sys-tab.active")).toHaveText("Mock Cabin");
    await expect(page.locator("#bat-pct")).toHaveText("45");
  });
});

test.describe("View toggle persistence", () => {
  test("persists selected view in localStorage across reload", async ({ page }) => {
    await switchView(page, "flow");
    await expect(page.locator("#flow-view")).toBeVisible();

    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("solar_view")))
      .toBe("flow");

    await page.reload();
    await expect(page.locator("#dashboard-screen")).toBeVisible();
    await expect(page.locator("#flow-view")).toBeVisible();
    await expect(page.locator("#tab-flow")).toHaveClass(/active/);

    await switchView(page, "chart");
    await expect(page.locator("#chart-view")).toBeVisible();
    await page.reload();
    await expect(page.locator("#chart-view")).toBeVisible();
  });
});

test.describe("Poll error toast", () => {
  async function failNextDataPoll(page, message = "Fetch failed: vendor offline") {
    await page.route("**/api/systems/*/data", async (route) => {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: message }),
      });
    });
  }

  async function restoreDataPoll(page) {
    await page.unroute("**/api/systems/*/data");
  }

  test("shows toast with retry on cards view and clears after success", async ({ page }) => {
    await failNextDataPoll(page);
    await page.locator("#system-tabs button", { hasText: "Mock Cabin" }).click();

    const toast = page.locator("#poll-error-toast");
    await expect(toast).toBeVisible();
    await expect(page.locator("#poll-error-msg")).toHaveText("Fetch failed: vendor offline");
    await expect(page.locator("#status-dot")).toHaveClass(/dot-err/);
    await expect(page.locator("#cards-view")).toBeVisible();

    await restoreDataPoll(page);
    await page.locator("#poll-retry-btn").click();

    await expect(toast).toBeHidden();
    await expect(page.locator("#bat-pct")).toHaveText("45");
    await expect(page.locator("#status-dot")).toHaveClass(/dot-ok/);
  });

  test("shows toast on flow view", async ({ page }) => {
    await switchView(page, "flow");
    await failNextDataPoll(page);
    await page.locator("#system-tabs button", { hasText: "Mock Home Solar" }).click();

    await expect(page.locator("#poll-error-toast")).toBeVisible();
    await expect(page.locator("#flow-view")).toBeVisible();
    await expect(page.locator("#poll-error-msg")).toContainText("Fetch failed");

    await restoreDataPoll(page);
    await page.locator("#poll-retry-btn").click();
    await waitForDashboardData(page);
    await expect(page.locator("#poll-error-toast")).toBeHidden();
  });
});
