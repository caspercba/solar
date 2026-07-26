import { test, expect } from "@playwright/test";
import {
  disableServiceWorker,
  clearAppStorage,
  loginViaDeepLink,
  waitForDashboardData,
  waitForHomeData,
  homeTile,
  openHomeSystem,
  enterSystemDetail,
  backToHome,
  switchView,
} from "../helpers.js";
import { MOCK_SYSTEM_ID, MOCK_SYSTEM_ID_2 } from "../fixtures/payloads.js";

test.beforeEach(async ({ page }) => {
  await disableServiceWorker(page);
  await page.goto("/");
  await clearAppStorage(page);
});

test.describe("HOME landing (compare-as-landing)", () => {
  test("after login with ≥2 systems, landing shows summary tiles not Cards", async ({ page }) => {
    await loginViaDeepLink(page);
    await waitForHomeData(page);

    await expect(page.locator("#compare-view")).toBeVisible();
    await expect(page.locator("#cards-view")).toBeHidden();
    await expect(page.locator("#flow-view")).toBeHidden();
    await expect(page.locator("#chart-view")).toBeHidden();
    await expect(page.locator("#view-toggle")).toBeHidden();
    await expect(page.locator("#detail-nav")).toBeHidden();
    await expect(page.locator("#tab-compare")).toHaveCount(0);

    const cards = page.locator(".compare-card");
    await expect(cards).toHaveCount(2);
    await expect(homeTile(page, "Mock Home Solar")).toBeVisible();
    await expect(homeTile(page, "Mock Cabin")).toBeVisible();
  });

  test("renders side-by-side metrics and highlights lowest SOC and generator", async ({ page }) => {
    await loginViaDeepLink(page);
    await waitForHomeData(page);

    const cabin = homeTile(page, "Mock Cabin");
    const home = homeTile(page, "Mock Home Solar");

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

  test("fills home tiles independently when one system is slow", async ({ page }) => {
    await page.route(`**/api/systems/${MOCK_SYSTEM_ID_2}/data`, async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });

    await loginViaDeepLink(page);
    await expect(page.locator("#compare-view")).toBeVisible();

    const home = homeTile(page, "Mock Home Solar");
    const cabin = homeTile(page, "Mock Cabin");

    await expect(home).not.toHaveClass(/skeleton/, { timeout: 5_000 });
    await expect(home.locator(".compare-metric-soc .compare-value")).toHaveText("72%");
    await expect(cabin).toHaveClass(/skeleton/);

    await expect(cabin).not.toHaveClass(/skeleton/, { timeout: 10_000 });
    await expect(cabin.locator(".compare-metric-soc .compare-value")).toHaveText("45%");
  });

  test("tap tile opens DETAIL; back returns to HOME", async ({ page }) => {
    await loginViaDeepLink(page);
    await waitForHomeData(page);

    await openHomeSystem(page, "Mock Cabin");
    await waitForDashboardData(page);

    await expect(page.locator("#detail-system-name")).toHaveText("Mock Cabin");
    await expect(page.locator("#view-toggle")).toBeVisible();
    await expect(page.locator("#tab-cards")).toBeVisible();
    await expect(page.locator("#tab-flow")).toBeVisible();
    await expect(page.locator("#tab-chart")).toBeVisible();
    await expect(page.locator("#tab-compare")).toHaveCount(0);

    // Default detail subview is Flow (mock 3).
    await expect(page.locator("#flow-view")).toBeVisible();
    await expect(page.locator("#bat-pct")).toHaveText("45");

    const activeId = await page.evaluate(() => localStorage.getItem("solar_active"));
    expect(activeId).toBe(MOCK_SYSTEM_ID_2);

    await backToHome(page);
    await waitForHomeData(page);
    await expect(page.locator(".compare-card")).toHaveCount(2);
  });

  test("single-system account still gets one HOME tile then DETAIL on tap", async ({ page }) => {
    await page.route("**/api/systems", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: MOCK_SYSTEM_ID,
            name: "Mock Home Solar",
            service: "shinemonitor",
            username: "mock-user@example.com",
            alerts: { enabled: false },
            gridInputLabel: "generator",
          },
        ]),
      });
    });

    await loginViaDeepLink(page);
    await waitForHomeData(page);

    await expect(page.locator(".compare-card")).toHaveCount(1);
    await expect(homeTile(page, "Mock Home Solar")).toBeVisible();
    await expect(page.locator("#cards-view")).toBeHidden();

    await enterSystemDetail(page, "Mock Home Solar", { view: "cards" });
    await expect(page.locator("#cards-view")).toBeVisible();
    await expect(page.locator("#bat-pct")).toHaveText("72");
  });

  test("Compare tab is absent from DETAIL view-tabs", async ({ page }) => {
    await loginViaDeepLink(page);
    await waitForHomeData(page);
    await openHomeSystem(page, "Mock Home Solar");

    await expect(page.locator("#view-toggle")).toBeVisible();
    await expect(page.locator("#tab-cards")).toBeVisible();
    await expect(page.locator("#tab-flow")).toBeVisible();
    await expect(page.locator("#tab-chart")).toBeVisible();
    await expect(page.locator("#tab-compare")).toHaveCount(0);
  });

  test("legacy compare localStorage preference lands on HOME", async ({ page }) => {
    await loginViaDeepLink(page);
    await waitForHomeData(page);
    await page.evaluate(() => localStorage.setItem("solar_view", "compare"));
    await page.reload();
    await expect(page.locator("#dashboard-screen")).toBeVisible();
    await waitForHomeData(page);
    await expect(page.locator("#compare-view")).toBeVisible();
    await expect(page.locator("#tab-compare")).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("solar_view")))
      .not.toBe("compare");
  });
});

test.describe("Cards view (DETAIL)", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaDeepLink(page);
    await waitForHomeData(page);
    await enterSystemDetail(page, "Mock Home Solar", { view: "cards" });
  });

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

  test("shows today's production tile with kWh total when mock history has data", async ({ page }) => {
    await expect(page.locator("#card-today-production")).toBeVisible();
    await expect(page.locator("#today-production-chart")).toBeVisible();
    await expect(page.locator("#today-production-empty")).toBeHidden();
    await expect(page.locator("#today-production-value")).not.toHaveText("--");
  });

  test("shows empty state when today's history has no points", async ({ page }) => {
    await page.route(`**/api/systems/${MOCK_SYSTEM_ID}/history`, async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("date")) {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          systemId: MOCK_SYSTEM_ID,
          name: "Mock Home Solar",
          service: "shinemonitor",
          date: "2026-07-07",
          timezoneOffset: -6,
          intervalMinutes: 5,
          points: [],
        }),
      });
    });

    await page.reload();
    await waitForHomeData(page);
    await enterSystemDetail(page, "Mock Home Solar", { view: "cards" });

    await expect(page.locator("#today-production-chart")).toBeHidden();
    await expect(page.locator("#today-production-empty")).toBeVisible();
    await expect(page.locator("#today-production-empty-msg")).toContainText(/no production data/i);
    await expect(page.locator("#today-production-value")).toHaveText("--");
  });
});

test.describe("Flow view (DETAIL)", () => {
  test("shows charging animation class for home system", async ({ page }) => {
    await loginViaDeepLink(page);
    await waitForHomeData(page);
    await enterSystemDetail(page, "Mock Home Solar", { view: "flow" });

    await expect(page.locator("#flow-view")).toBeVisible();
    const batPath = page.locator("#fp-bat");
    await expect(batPath).toHaveClass(/charging/);
    await expect(batPath).not.toHaveClass(/discharging/);
    await expect(page.locator("#fn-bat-bg")).toHaveClass(/charging/);
  });

  test("shows discharging animation class when cabin system selected", async ({ page }) => {
    await loginViaDeepLink(page);
    await waitForHomeData(page);
    await enterSystemDetail(page, "Mock Cabin", { view: "flow" });

    const batPath = page.locator("#fp-bat");
    await expect(batPath).toHaveClass(/discharging/);
    await expect(page.locator("#fn-bat-bg")).toHaveClass(/discharging/);
  });
});

test.describe("System switching via HOME tiles", () => {
  test("tap-through switches active system and reloads data", async ({ page }) => {
    await loginViaDeepLink(page);
    await waitForHomeData(page);
    await enterSystemDetail(page, "Mock Cabin", { view: "cards" });

    await expect(page.locator("#bat-pct")).toHaveText("45");
    await expect(page.locator("#bat-direction")).toHaveText("Discharging");
    await expect(page.locator("#detail-system-name")).toHaveText("Mock Cabin");

    const activeId = await page.evaluate(() => localStorage.getItem("solar_active"));
    expect(activeId).toBe(MOCK_SYSTEM_ID_2);
  });

  test("persists active system id across reload (HOME still lands first)", async ({ page }) => {
    await loginViaDeepLink(page);
    await waitForHomeData(page);
    await openHomeSystem(page, "Mock Cabin");
    await waitForDashboardData(page);

    await page.reload();
    await expect(page.locator("#dashboard-screen")).toBeVisible();
    await waitForHomeData(page);
    await expect(page.locator("#compare-view")).toBeVisible();

    const activeId = await page.evaluate(() => localStorage.getItem("solar_active"));
    expect(activeId).toBe(MOCK_SYSTEM_ID_2);

    await enterSystemDetail(page, "Mock Cabin", { view: "cards" });
    await expect(page.locator("#bat-pct")).toHaveText("45");
  });
});

test.describe("Generator runtime", () => {
  const GEN_RUNTIME_KEY = `solar_gen_runtime_${MOCK_SYSTEM_ID_2}`;

  test("shows no runtime badge while generator is off", async ({ page }) => {
    await loginViaDeepLink(page);
    await waitForHomeData(page);
    await enterSystemDetail(page, "Mock Home Solar", { view: "cards" });
    await expect(page.locator("#gen-status")).toHaveText("OFF");
    await expect(page.locator("#gen-runtime")).toBeHidden();
  });

  test("shows accumulated runtime while generator is active and persists across reload", async ({ page }) => {
    await loginViaDeepLink(page);
    await waitForHomeData(page);
    await enterSystemDetail(page, "Mock Cabin", { view: "cards" });
    await expect(page.locator("#gen-status")).toHaveText("ON");

    // Seed 26 minutes accumulated in a prior poll, as if the generator has
    // been running since before this page load (session counter, not vendor data).
    await page.evaluate(
      ({ key, seconds }) => localStorage.setItem(key, JSON.stringify({ accumulatedSec: seconds, activeSince: null })),
      { key: GEN_RUNTIME_KEY, seconds: 26 * 60 },
    );

    await page.reload();
    await expect(page.locator("#dashboard-screen")).toBeVisible();
    await waitForHomeData(page);
    await enterSystemDetail(page, "Mock Cabin", { view: "cards" });

    await expect(page.locator("#gen-runtime")).toBeVisible();
    await expect(page.locator("#gen-runtime-value")).toHaveText("26m");
  });

  test("resets on disconnect", async ({ page }) => {
    await loginViaDeepLink(page);
    await waitForHomeData(page);
    await enterSystemDetail(page, "Mock Cabin", { view: "cards" });

    await page.evaluate(
      ({ key, seconds }) => localStorage.setItem(key, JSON.stringify({ accumulatedSec: seconds, activeSince: null })),
      { key: GEN_RUNTIME_KEY, seconds: 26 * 60 },
    );

    await page.locator("#disconnect-btn").click();
    await expect(page.locator("#setup-screen")).toBeVisible();

    const stored = await page.evaluate((key) => localStorage.getItem(key), GEN_RUNTIME_KEY);
    expect(stored).toBeNull();

    await loginViaDeepLink(page);
    await waitForHomeData(page);
    await enterSystemDetail(page, "Mock Cabin", { view: "cards" });

    await expect(page.locator("#gen-runtime")).toBeHidden();
  });
});

test.describe("View toggle persistence", () => {
  test("persists detail subview in localStorage; reload lands on HOME then restores subview", async ({ page }) => {
    await loginViaDeepLink(page);
    await waitForHomeData(page);
    await enterSystemDetail(page, "Mock Home Solar", { view: "flow" });
    await expect(page.locator("#flow-view")).toBeVisible();

    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("solar_view")))
      .toBe("flow");

    await page.reload();
    await expect(page.locator("#dashboard-screen")).toBeVisible();
    await waitForHomeData(page);
    await expect(page.locator("#compare-view")).toBeVisible();

    await openHomeSystem(page, "Mock Home Solar");
    await expect(page.locator("#flow-view")).toBeVisible();
    await expect(page.locator("#tab-flow")).toHaveClass(/active/);

    await switchView(page, "chart");
    await expect(page.locator("#chart-view")).toBeVisible();
    await page.reload();
    await waitForHomeData(page);
    await openHomeSystem(page, "Mock Home Solar");
    await expect(page.locator("#chart-view")).toBeVisible();
  });
});

test.describe("Keyboard refresh", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("F5 refreshes data without reloading the page", async ({ page }) => {
    await loginViaDeepLink(page);
    await waitForHomeData(page);
    await enterSystemDetail(page, "Mock Home Solar", { view: "cards" });

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
    await loginViaDeepLink(page);
    await waitForHomeData(page);
    await enterSystemDetail(page, "Mock Home Solar", { view: "cards" });

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
    await loginViaDeepLink(page);
    await waitForHomeData(page);
    await enterSystemDetail(page, "Mock Home Solar", { view: "chart" });
    await expect(page.locator("#chart-loading")).toBeHidden();

    let historyRequestCount = 0;
    await page.route("**/api/systems/*/history?*", async (route) => {
      historyRequestCount += 1;
      await route.continue();
    });

    await page.locator("#chart-date").focus();
    const before = historyRequestCount;

    await page.keyboard.press("F5");
    await page.waitForTimeout(500);

    expect(historyRequestCount).toBe(before);
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
    await loginViaDeepLink(page);
    await waitForHomeData(page);
    await enterSystemDetail(page, "Mock Home Solar", { view: "cards" });

    await failNextDataPoll(page);
    await backToHome(page);
    await openHomeSystem(page, "Mock Cabin");

    const toast = page.locator("#poll-error-toast");
    await expect(toast).toBeVisible();
    await expect(page.locator("#poll-error-msg")).toHaveText("Fetch failed: vendor offline");
    await expect(page.locator("#status-dot")).toHaveClass(/dot-err/);

    await restoreDataPoll(page);
    await page.locator("#poll-retry-btn").click();

    await expect(toast).toBeHidden();
    await expect(page.locator("#bat-pct")).toHaveText("45");
    await expect(page.locator("#status-dot")).toHaveClass(/dot-ok/);
  });

  test("shows toast on flow view", async ({ page }) => {
    await loginViaDeepLink(page);
    await waitForHomeData(page);
    await enterSystemDetail(page, "Mock Home Solar", { view: "flow" });

    await failNextDataPoll(page);
    await backToHome(page);
    await openHomeSystem(page, "Mock Cabin");

    await expect(page.locator("#poll-error-toast")).toBeVisible();
    await expect(page.locator("#flow-view")).toBeVisible();
    await expect(page.locator("#poll-error-msg")).toContainText("Fetch failed");

    await restoreDataPoll(page);
    await page.locator("#poll-retry-btn").click();
    await waitForDashboardData(page);
    await expect(page.locator("#poll-error-toast")).toBeHidden();
  });
});
