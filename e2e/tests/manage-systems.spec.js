import { test, expect } from "@playwright/test";
import {
  disableServiceWorker,
  clearAppStorage,
  loginViaDeepLink,
  waitForDashboardData,
  MOCK_WORKER_URL,
} from "../helpers.js";

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

  test.afterEach(async ({ request }) => {
    // Fixture systems are mutated in place by add/remove — restore the
    // pristine two-system list so later spec files aren't affected.
    await request.post(`${MOCK_WORKER_URL}/__e2e__/reset`);
  });

  test("adds a system via the modal and the list updates", async ({ page }) => {
    await expect(page.locator(".manage-row")).toHaveCount(2);

    await page.locator("#manage-add").click();
    await expect(page.locator("#add-system-modal")).toBeVisible();

    await page.locator("#add-service").selectOption("shinemonitor");
    await page.locator("#add-name").fill("E2E New System");
    await page.locator("#add-user").fill("e2e-new-user@example.com");
    await page.locator("#add-pass").fill("e2e-new-password");
    await page.locator("#add-submit").click();

    await expect(page.locator("#add-system-modal")).toBeHidden();

    // Successful add closes the Add modal without reopening Manage — reopen
    // to confirm the new system is persisted and rendered in the list.
    await page.locator("#manage-btn").click();
    await expect(page.locator("#manage-modal")).toBeVisible();
    await expect(page.locator(".manage-row")).toHaveCount(3);
    await expect(page.locator(".manage-row", { hasText: "E2E New System" })).toBeVisible();

    await expect(page.locator("#system-tabs")).toBeVisible();
    await expect(page.locator(".sys-tab", { hasText: "E2E New System" })).toBeVisible();
  });

  test("removes a system with the confirm dialog and hides the tab bar at one system", async ({ page }) => {
    await expect(page.locator("#system-tabs")).toBeVisible();
    await expect(page.locator(".sys-tab")).toHaveCount(2);

    page.once("dialog", (dialog) => dialog.accept());
    await page
      .locator(".manage-row", { hasText: "Mock Cabin" })
      .locator(".manage-delete")
      .click();

    await expect(page.locator(".manage-row")).toHaveCount(1);
    await expect(page.locator(".manage-row", { hasText: "Mock Cabin" })).toHaveCount(0);

    await expect(page.locator("#system-tabs")).toBeHidden();
    await expect(page.locator("#header-title")).toHaveText("Mock Home Solar");
  });

  test("keeps the system when the confirm dialog is dismissed", async ({ page }) => {
    page.once("dialog", (dialog) => dialog.dismiss());
    await page
      .locator(".manage-row", { hasText: "Mock Cabin" })
      .locator(".manage-delete")
      .click();

    await expect(page.locator(".manage-row")).toHaveCount(2);
    await expect(page.locator(".manage-row", { hasText: "Mock Cabin" })).toBeVisible();
    await expect(page.locator("#system-tabs")).toBeVisible();
  });
});
