import { test, expect } from "@playwright/test";
import {
  disableServiceWorker,
  clearAppStorage,
  loginViaDeepLink,
  waitForDashboardData,
} from "../helpers.js";
import { MOCK_SYSTEM_ID } from "../fixtures/payloads.js";

test.describe("Manage modal — credential rotation", () => {
  test.beforeEach(async ({ page }) => {
    await disableServiceWorker(page);
    await page.goto("/");
    await clearAppStorage(page);
    await loginViaDeepLink(page);
    await waitForDashboardData(page);
    await page.locator("#manage-btn").click();
    await expect(page.locator("#manage-modal")).toBeVisible();
  });

  function homeRow(page) {
    return page.locator(".manage-row", { hasText: "Mock Home Solar" });
  }

  test("rotates credentials and shows success message", async ({ page }) => {
    let putRequest = null;
    await page.route(`**/api/systems/${MOCK_SYSTEM_ID}/credentials`, async (route) => {
      putRequest = { method: route.request().method(), body: route.request().postDataJSON() };
      await route.continue();
    });

    const row = homeRow(page);
    await row.locator(".cred-user").fill("new-user@example.com");
    await row.locator(".cred-pass").fill("new-secret-password");
    await row.locator(".cred-save").click();

    await expect(row.locator(".cred-msg")).toBeVisible();
    await expect(row.locator(".cred-msg")).toHaveText("Credentials updated");
    await expect(row.locator(".cred-msg")).toHaveClass(/cred-ok/);
    await expect(row.locator(".cred-save")).toHaveText("Save credentials");
    await expect(row.locator(".cred-save")).toBeEnabled();

    // Password field is cleared after a successful save; username reflects the new value.
    await expect(row.locator(".cred-pass")).toHaveValue("");
    await expect(row.locator(".cred-user")).toHaveValue("new-user@example.com");

    expect(putRequest).not.toBeNull();
    expect(putRequest.method).toBe("PUT");
    expect(putRequest.body).toEqual({ user: "new-user@example.com", password: "new-secret-password" });
  });

  test("shows 502 error message on invalid credentials and keeps form editable", async ({ page }) => {
    const row = homeRow(page);
    await row.locator(".cred-user").fill("new-user@example.com");
    await row.locator(".cred-pass").fill("bad-password");
    await row.locator(".cred-save").click();

    await expect(row.locator(".cred-msg")).toBeVisible();
    await expect(row.locator(".cred-msg")).toHaveText("Discovery failed: Invalid credentials");
    await expect(row.locator(".cred-msg")).toHaveClass(/cred-err/);
    await expect(row.locator(".cred-save")).toHaveText("Save credentials");
    await expect(row.locator(".cred-save")).toBeEnabled();

    // Failed save leaves the entered password in place so the user can retry.
    await expect(row.locator(".cred-pass")).toHaveValue("bad-password");
  });
});
