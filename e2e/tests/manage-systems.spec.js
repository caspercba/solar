import { test, expect } from "@playwright/test";
import {
  disableServiceWorker,
  clearAppStorage,
  loginViaDeepLink,
  waitForDashboardData,
} from "../helpers.js";
import { MOCK_SYSTEM_ID, MOCK_SYSTEM_ID_2, defaultAlerts } from "../fixtures/payloads.js";

const NEW_SYSTEM_ID = "e2e-mock-new-003";

test.describe("Add system", () => {
  test("adds a system via the happy path and lands on its dashboard", async ({ page }) => {
    let postBody = null;
    let systemAdded = false;

    await page.route("**/api/systems", async (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        const body = systemAdded
          ? [{
            id: NEW_SYSTEM_ID,
            name: "New Cabin",
            service: "shinemonitor",
            username: "new-user@example.com",
            alerts: { ...defaultAlerts },
          }]
          : [];
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
        return;
      }
      if (request.method() === "POST") {
        postBody = request.postDataJSON();
        systemAdded = true;
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: NEW_SYSTEM_ID,
            name: "New Cabin",
            service: "shinemonitor",
            discovered: { plantId: "mock-plant-new" },
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.route(`**/api/systems/${NEW_SYSTEM_ID}/data`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          systemId: NEW_SYSTEM_ID,
          name: "New Cabin",
          service: "shinemonitor",
          timestamp: "2026-07-03 14:32:00",
          battery: { voltage: 51.0, soc: 88, current: -5, power: -255 },
          solar: { power: 900, voltage: 90 },
          load: { power: 400, percent: 12 },
          grid: { power: 0, voltage: 0, active: false },
          inverter: { ratedPower: 3500, nominalPV: 5000 },
          status: "PV Charging",
          energyToday: 8.1,
        }),
      });
    });

    await disableServiceWorker(page);
    await page.goto("/");
    await clearAppStorage(page);
    await loginViaDeepLink(page);

    // No systems configured yet, so the app auto-opens the add-system modal on boot.
    await expect(page.locator("#add-system-modal")).toBeVisible();

    await page.locator("#add-service").selectOption("shinemonitor");
    await page.locator("#add-name").fill("New Cabin");
    await page.locator("#add-user").fill("new-user@example.com");
    await page.locator("#add-pass").fill("new-secret-password");
    await page.locator("#add-submit").click();

    await expect(page.locator("#add-system-modal")).toBeHidden();
    await waitForDashboardData(page);
    await expect(page.locator("#header-title")).toHaveText("New Cabin");

    expect(postBody).toEqual({
      service: "shinemonitor",
      name: "New Cabin",
      user: "new-user@example.com",
      password: "new-secret-password",
    });
  });

  test("shows a discovery failure and keeps the form editable", async ({ page }) => {
    await disableServiceWorker(page);
    await page.goto("/");
    await clearAppStorage(page);
    await loginViaDeepLink(page);
    await waitForDashboardData(page);

    await page.route("**/api/systems", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ error: "Discovery failed: Invalid credentials" }),
        });
        return;
      }
      await route.continue();
    });

    await page.locator("#manage-btn").click();
    await page.locator("#manage-add").click();
    await expect(page.locator("#add-system-modal")).toBeVisible();

    await page.locator("#add-service").selectOption("shinemonitor");
    await page.locator("#add-user").fill("bad-user@example.com");
    await page.locator("#add-pass").fill("bad-password");
    await page.locator("#add-submit").click();

    await expect(page.locator("#add-error")).toBeVisible();
    await expect(page.locator("#add-error")).toHaveText("Discovery failed: Invalid credentials");
    await expect(page.locator("#add-system-modal")).toBeVisible();
    await expect(page.locator("#add-submit")).toBeEnabled();
    await expect(page.locator("#add-submit")).toHaveText("Add System");
  });
});

test.describe("Remove system", () => {
  test.beforeEach(async ({ page }) => {
    await disableServiceWorker(page);
    await page.goto("/");
    await clearAppStorage(page);
    await loginViaDeepLink(page);
    await waitForDashboardData(page);
    await page.locator("#manage-btn").click();
    await expect(page.locator("#manage-modal")).toBeVisible();
  });

  function manageRow(page, name) {
    return page.locator(".manage-row", { hasText: name });
  }

  test("removes a system via the confirm dialog and refreshes the UI", async ({ page }) => {
    let deleteRequest = null;

    await page.route(`**/api/systems/${MOCK_SYSTEM_ID_2}`, async (route) => {
      deleteRequest = { method: route.request().method() };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await page.route("**/api/systems", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{
            id: MOCK_SYSTEM_ID,
            name: "Mock Home Solar",
            service: "shinemonitor",
            username: "mock-user@example.com",
            alerts: { ...defaultAlerts },
          }]),
        });
        return;
      }
      await route.continue();
    });

    page.once("dialog", (dialog) => dialog.accept());

    await expect(manageRow(page, "Mock Cabin")).toBeVisible();
    await manageRow(page, "Mock Cabin").locator(".manage-delete").click();

    await expect.poll(() => deleteRequest?.method).toBe("DELETE");

    await expect(manageRow(page, "Mock Cabin")).toHaveCount(0);
    await expect(manageRow(page, "Mock Home Solar")).toBeVisible();
    await expect(page.locator("#system-tabs")).toBeHidden();
    await expect(page.locator("#header-title")).toHaveText("Mock Home Solar");
  });

  test("keeps the system when the confirm dialog is dismissed", async ({ page }) => {
    let deleteCalled = false;
    await page.route(`**/api/systems/${MOCK_SYSTEM_ID_2}`, async (route) => {
      deleteCalled = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    page.once("dialog", (dialog) => dialog.dismiss());

    await manageRow(page, "Mock Cabin").locator(".manage-delete").click();
    await page.waitForTimeout(300);

    expect(deleteCalled).toBe(false);
    await expect(manageRow(page, "Mock Cabin")).toBeVisible();
  });
});
