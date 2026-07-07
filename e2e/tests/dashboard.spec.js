import { test, expect } from "@playwright/test";
import {
  disableServiceWorker,
  clearAppStorage,
  loginViaDeepLink,
  waitForDashboardData,
  waitForCompareData,
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

test.describe("Compare view", () => {
  test("shows Compare tab when two or more systems configured", async ({ page }) => {
    await expect(page.locator("#tab-compare")).toBeVisible();
    await expect(page.locator("#tab-compare")).toHaveText("Compare");
  });

  test("renders side-by-side metrics and highlights lowest SOC and generator", async ({ page }) => {
    await switchView(page, "compare");
    await waitForCompareData(page);

    const cards = page.locator(".compare-card");
    await expect(cards).toHaveCount(2);

    const cabin = page.locator(".compare-card", { hasText: "Mock Cabin" });
    const home = page.locator(".compare-card", { hasText: "Mock Home Solar" });

    await expect(cabin).toHaveClass(/compare-lowest-soc/);
    await expect(cabin).toHaveClass(/compare-gen-active/);
    await expect(cabin.locator(".compare-highlight-lowest")).toBeVisible();
    await expect(cabin.locator(".compare-highlight-gen")).toBeVisible();
    await expect(cabin.locator(".compare-metric-soc .compare-value")).toHaveText("45%");
    await expect(cabin.locator(".compare-metric-solar .compare-value")).toHaveText("1200 W");
    await expect(cabin.locator(".compare-metric-load .compare-value")).toHaveText("850 W");
    await expect(cabin.locator(".gen-badge")).toHaveText("ON");

    await expect(home).not.toHaveClass(/compare-lowest-soc/);
    await expect(home).not.toHaveClass(/compare-gen-active/);
    await expect(home.locator(".compare-metric-soc .compare-value")).toHaveText("72%");
    await expect(home.locator(".gen-badge")).toHaveText("OFF");
  });

  test("persists compare view in localStorage across reload", async ({ page }) => {
    await switchView(page, "compare");
    await waitForCompareData(page);

    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("solar_view")))
      .toBe("compare");

    await page.reload();
    await expect(page.locator("#compare-view")).toBeVisible();
    await expect(page.locator("#tab-compare")).toHaveClass(/active/);
    await waitForCompareData(page);
  });

  test("hides system tabs while comparing all systems", async ({ page }) => {
    await switchView(page, "compare");
    await waitForCompareData(page);
    await expect(page.locator("#system-tabs")).toBeHidden();
  });
});

test.describe("Keyboard refresh", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("F5 refreshes data without reloading the page", async ({ page }) => {
    let dataRequestCount = 0;
    await page.route("**/api/systems/*/data", async (route) => {
      dataRequestCount += 1;
      await route.continue();
    });

    await page.locator("#cards-view").click();
    const before = dataRequestCount;

    const navigated = page.waitForEvent("framenavigated", { timeout: 2000 }).catch(() => null);
    await page.keyboard.press("F5");

    await expect.poll(() => dataRequestCount, { timeout: 10_000 }).toBeGreaterThan(before);
    expect(await navigated).toBeNull();
  });

  test("Ctrl+R refreshes data without reloading the page", async ({ page }) => {
    let dataRequestCount = 0;
    await page.route("**/api/systems/*/data", async (route) => {
      dataRequestCount += 1;
      await route.continue();
    });

    await page.locator("#cards-view").click();
    const before = dataRequestCount;

    const navigated = page.waitForEvent("framenavigated", { timeout: 2000 }).catch(() => null);
    await page.keyboard.press("Control+r");

    await expect.poll(() => dataRequestCount, { timeout: 10_000 }).toBeGreaterThan(before);
    expect(await navigated).toBeNull();
  });

  test("does not intercept F5 when a text input is focused", async ({ page }) => {
    await switchView(page, "chart");
    await page.locator("#chart-date").focus();

    const navigated = page.waitForEvent("framenavigated");
    await page.keyboard.press("F5");
    await navigated;
  });
});

test.describe("Poll interval settings", () => {
  async function openManageModal(page) {
    await page.locator("#manage-btn").click();
    await expect(page.locator("#manage-modal")).toBeVisible();
  }

  test("shows refresh interval selector with supported options", async ({ page }) => {
    await openManageModal(page);

    const select = page.locator("#poll-interval");
    await expect(select).toBeVisible();
    await expect(select.locator("option")).toHaveText(["30 seconds", "60 seconds", "2 minutes"]);
    await expect(select).toHaveValue("60");
  });

  test("persists chosen poll interval across reload", async ({ page }) => {
    await openManageModal(page);
    await page.locator("#poll-interval").selectOption("120");

    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("solar_poll_interval")))
      .toBe("120");

    await page.locator("#manage-close").click();
    await page.reload();
    await waitForDashboardData(page);

    await openManageModal(page);
    await expect(page.locator("#poll-interval")).toHaveValue("120");
  });

  test("restarts polling immediately when refresh interval changes", async ({ page }) => {
    let dataRequestCount = 0;
    await page.route("**/api/systems/*/data", async (route) => {
      dataRequestCount += 1;
      await route.continue();
    });

    await waitForDashboardData(page);
    const before = dataRequestCount;

    await openManageModal(page);
    await page.locator("#poll-interval").selectOption("30");

    await expect.poll(() => dataRequestCount, { timeout: 10_000 }).toBeGreaterThan(before);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("solar_poll_interval")))
      .toBe("30");
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
