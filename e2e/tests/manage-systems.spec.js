import { test, expect } from "@playwright/test";
import {
  disableServiceWorker,
  clearAppStorage,
  loginViaDeepLink,
  waitForDashboardData,
  MOCK_WORKER_URL,
} from "../helpers.js";
import { MOCK_SYSTEM_ID, MOCK_SYSTEM_ID_2 } from "../fixtures/payloads.js";

const NEW_SYSTEM_ID = "e2e-mock-new-003";

function baseSystemsList(extra = []) {
  return [
    { id: MOCK_SYSTEM_ID, name: "Mock Home Solar", service: "shinemonitor", username: "mock-user@example.com", alerts: { enabled: false } },
    { id: MOCK_SYSTEM_ID_2, name: "Mock Cabin", service: "growatt", username: "growatt-mock@example.com", alerts: { enabled: false } },
    ...extra,
  ];
}

async function openManageModal(page) {
  await page.locator("#manage-btn").click();
  await expect(page.locator("#manage-modal")).toBeVisible();
}

async function openAddModal(page) {
  await openManageModal(page);
  await page.locator("#manage-add").click();
  await expect(page.locator("#add-system-modal")).toBeVisible();
}

// These specs mutate the shared mock Worker's systems list (add/remove), so
// keep them from interleaving with each other and always restore the
// default two-system fixture afterwards — other spec files sharing this
// mock Worker process assume "Mock Home Solar" + "Mock Cabin" both exist.
test.describe.configure({ mode: "serial" });

test.describe("Manage modal — add/remove systems", () => {
  test.beforeEach(async ({ page }) => {
    await disableServiceWorker(page);
    await page.goto("/");
    await clearAppStorage(page);
    await loginViaDeepLink(page);
    await waitForDashboardData(page);
  });

  test.afterEach(async ({ page }) => {
    await page.request.post(`${MOCK_WORKER_URL}/__mock__/reset-systems`);
  });

  test("adds a system via the modal and the list updates", async ({ page }) => {
    await openManageModal(page);

    let postRequest = null;
    await page.route("**/api/systems", async (route) => {
      if (route.request().method() === "POST") {
        postRequest = { method: "POST", body: route.request().postDataJSON() };
      }
      await route.continue();
    });

    await page.locator("#manage-add").click();
    await expect(page.locator("#add-system-modal")).toBeVisible();
    await expect(page.locator("#manage-modal")).toBeHidden();

    await page.locator("#add-service").selectOption("growatt");
    await page.locator("#add-name").fill("E2E Added System");
    await page.locator("#add-user").fill("e2e-new-user@example.com");
    await page.locator("#add-pass").fill("e2e-new-password");
    await page.locator("#add-submit").click();

    await expect(page.locator("#add-system-modal")).toBeHidden();

    expect(postRequest).not.toBeNull();
    expect(postRequest.body).toEqual({
      service: "growatt",
      name: "E2E Added System",
      user: "e2e-new-user@example.com",
      password: "e2e-new-password",
      gridInputLabel: "generator",
    });

    // Reopen the manage modal — adding a system doesn't reopen it automatically.
    await page.locator("#manage-btn").click();
    await expect(page.locator("#manage-modal")).toBeVisible();

    const newRow = page.locator(".manage-row", { hasText: "E2E Added System" });
    await expect(newRow).toBeVisible();
    await expect(newRow.locator(".manage-service")).toContainText("growatt");

    // Three systems now — tab bar shows all of them.
    await expect(page.locator("#system-tabs")).toBeVisible();
    await expect(page.locator("#system-tabs button", { hasText: "E2E Added System" })).toBeVisible();
  });

  test("adds a system and lands on its dashboard", async ({ page }) => {
    await openAddModal(page);

    let postBody = null;
    await page.route("**/api/systems", async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        postBody = request.postDataJSON();
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: NEW_SYSTEM_ID,
            name: "New Growatt Site",
            service: "growatt",
            discovered: { plantId: "mock-plant-9" },
          }),
        });
        return;
      }
      if (request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(baseSystemsList([
            { id: NEW_SYSTEM_ID, name: "New Growatt Site", service: "growatt", username: "new-user@example.com", alerts: { enabled: false } },
          ])),
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
          name: "New Growatt Site",
          service: "growatt",
          timestamp: "2026-07-03 15:00:00",
          battery: { voltage: 51.4, soc: 91, current: -8, power: -412 },
          solar: { power: 2100, voltage: 180 },
          load: { power: 640, percent: 18 },
          grid: { power: 0, voltage: 0, active: false },
          inverter: { ratedPower: 5000, nominalPV: 6000 },
          status: "PV Charging",
          energyToday: 20.1,
        }),
      });
    });

    await page.locator("#add-service").selectOption("growatt");
    await page.locator("#add-name").fill("New Growatt Site");
    await page.locator("#add-user").fill("new-user@example.com");
    await page.locator("#add-pass").fill("new-secret-password");
    await page.locator("#add-submit").click();

    await expect(page.locator("#add-system-modal")).toBeHidden();
    expect(postBody).toEqual({
      service: "growatt",
      name: "New Growatt Site",
      user: "new-user@example.com",
      password: "new-secret-password",
      gridInputLabel: "generator",
    });

    const tabs = page.locator("#system-tabs .sys-tab");
    await expect(tabs).toHaveCount(3);
    const newTab = page.locator("#system-tabs button", { hasText: "New Growatt Site" });
    await expect(newTab).toBeVisible();

    await newTab.click();
    await expect(page.locator("#bat-pct")).toHaveText("91");
    await expect(page.locator("#system-tabs .sys-tab.active")).toHaveText("New Growatt Site");
  });

  test("shows discovery failure and keeps the modal open for retry", async ({ page }) => {
    await openAddModal(page);
    await page.route("**/api/systems", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "Discovery failed: Invalid credentials" }),
      });
    });

    await page.locator("#add-service").selectOption("shinemonitor");
    await page.locator("#add-user").fill("bad-user@example.com");
    await page.locator("#add-pass").fill("bad-password");
    await page.locator("#add-submit").click();

    await expect(page.locator("#add-error")).toBeVisible();
    await expect(page.locator("#add-error")).toHaveText("Discovery failed: Invalid credentials");
    await expect(page.locator("#add-system-modal")).toBeVisible();
    await expect(page.locator("#add-submit")).toBeEnabled();
    await expect(page.locator("#add-submit")).toHaveText("Add System");

    const tabs = page.locator("#system-tabs .sys-tab");
    await expect(tabs).toHaveCount(2);
  });

  test("removes a system with confirm dialog and hides the tab bar at one system", async ({ page }) => {
    await openManageModal(page);
    await expect(page.locator("#system-tabs")).toBeVisible();

    const cabinRow = page.locator(".manage-row", { hasText: "Mock Cabin" });
    await expect(cabinRow).toBeVisible();

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("Mock Cabin");
      await dialog.accept();
    });
    await cabinRow.locator(".manage-delete").click();

    await expect(cabinRow).toHaveCount(0);
    await expect(page.locator(".manage-row", { hasText: "Mock Home Solar" })).toBeVisible();

    // One system remains — tab bar hides, header shows its name.
    await expect(page.locator("#system-tabs")).toBeHidden();
    await expect(page.locator("#header-title")).toHaveText("Mock Home Solar");
  });

  test("dismissing the confirm dialog keeps the system in the list", async ({ page }) => {
    await openManageModal(page);

    const cabinRow = page.locator(".manage-row", { hasText: "Mock Cabin" });
    await expect(cabinRow).toBeVisible();

    page.once("dialog", async (dialog) => {
      await dialog.dismiss();
    });
    await cabinRow.locator(".manage-delete").click();

    await expect(cabinRow).toBeVisible();
    await expect(page.locator("#system-tabs")).toBeVisible();
  });

  test.describe("remove (mocked API)", () => {
    test.beforeEach(async ({ page }) => {
      await openManageModal(page);
    });

    test("removes a system via the confirm dialog", async ({ page }) => {
      let dialogMessage = null;
      page.once("dialog", (dialog) => {
        dialogMessage = dialog.message();
        dialog.accept();
      });

      let deleteRequested = false;
      await page.route(`**/api/systems/${MOCK_SYSTEM_ID_2}`, async (route) => {
        if (route.request().method() !== "DELETE") {
          await route.continue();
          return;
        }
        deleteRequested = true;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      });
      await page.route("**/api/systems", async (route) => {
        if (route.request().method() !== "GET") {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            { id: MOCK_SYSTEM_ID, name: "Mock Home Solar", service: "shinemonitor", username: "mock-user@example.com", alerts: { enabled: false } },
          ]),
        });
      });

      await expect(page.locator(".manage-row", { hasText: "Mock Cabin" })).toBeVisible();
      await page.locator(".manage-row", { hasText: "Mock Cabin" }).locator(".manage-delete").click();

      await expect.poll(() => deleteRequested).toBe(true);
      expect(dialogMessage).toBe('Remove "Mock Cabin"?');

      await expect(page.locator(".manage-row", { hasText: "Mock Cabin" })).toHaveCount(0);
      await expect(page.locator(".manage-row", { hasText: "Mock Home Solar" })).toBeVisible();
      await expect(page.locator("#system-tabs")).toBeHidden();
      await expect(page.locator("#header-title")).toHaveText("Mock Home Solar");
    });

    test("cancelling the confirm dialog leaves the system in place", async ({ page }) => {
      page.once("dialog", (dialog) => dialog.dismiss());

      let deleteRequested = false;
      await page.route(`**/api/systems/${MOCK_SYSTEM_ID_2}`, async (route) => {
        deleteRequested = true;
        await route.continue();
      });

      await page.locator(".manage-row", { hasText: "Mock Cabin" }).locator(".manage-delete").click();
      await page.waitForTimeout(300);

      expect(deleteRequested).toBe(false);
      await expect(page.locator(".manage-row", { hasText: "Mock Cabin" })).toBeVisible();
    });
  });
});
