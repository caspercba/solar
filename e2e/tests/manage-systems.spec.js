import { test, expect } from "@playwright/test";
import {
  disableServiceWorker,
  clearAppStorage,
  loginViaDeepLink,
  waitForDashboardData,
  MOCK_WORKER_URL,
} from "../helpers.js";

// These specs mutate the shared mock Worker's systems list (add/remove), so
// keep them from interleaving with each other and always restore the
// default two-system fixture afterwards — other spec files sharing this
// mock Worker process assume "Mock Home Solar" + "Mock Cabin" both exist.
test.describe.configure({ mode: "serial" });

test.describe("Manage modal — add and remove systems", () => {
  test.beforeEach(async ({ page }) => {
    await disableServiceWorker(page);
    await page.goto("/");
    await clearAppStorage(page);
    await loginViaDeepLink(page);
    await waitForDashboardData(page);
    await page.locator("#manage-btn").click();
    await expect(page.locator("#manage-modal")).toBeVisible();
  });

  test.afterEach(async ({ page }) => {
    await page.request.post(`${MOCK_WORKER_URL}/__mock__/reset-systems`);
  });

  test("adds a system via the modal and the list updates", async ({ page }) => {
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

  test("removes a system with confirm dialog and hides the tab bar at one system", async ({ page }) => {
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
    const cabinRow = page.locator(".manage-row", { hasText: "Mock Cabin" });
    await expect(cabinRow).toBeVisible();

    page.once("dialog", async (dialog) => {
      await dialog.dismiss();
    });
    await cabinRow.locator(".manage-delete").click();

    await expect(cabinRow).toBeVisible();
    await expect(page.locator("#system-tabs")).toBeVisible();
  });
});
