import { test, expect } from "@playwright/test";
import {
  disableServiceWorker,
  clearAppStorage,
  loginViaDeepLink,
  waitForHomeData,
} from "../helpers.js";
import { MOCK_SYSTEM_ID } from "../fixtures/payloads.js";

test.describe("System detail — alert configuration", () => {
  test.beforeEach(async ({ page }) => {
    await disableServiceWorker(page);
    await page.goto("/");
    await clearAppStorage(page);
    await loginViaDeepLink(page);
    await waitForHomeData(page);
    await page.locator("#manage-btn").click();
    await expect(page.locator("#manage-modal")).toBeVisible();
    await page.locator(".manage-row", { hasText: "Mock Home Solar" }).click();
    await expect(page.locator("#system-detail-modal")).toBeVisible();
  });

  function detail(page) {
    return page.locator("#system-detail-modal");
  }

  function alertForm(page) {
    return detail(page).locator(".manage-alerts");
  }

  test("saves threshold, notify toggles, and webhook via PUT /alerts", async ({ page }) => {
    let putRequest = null;
    await page.route(`**/api/systems/${MOCK_SYSTEM_ID}/alerts`, async (route) => {
      putRequest = { method: route.request().method(), body: route.request().postDataJSON() };
      await route.continue();
    });

    const form = alertForm(page);
    await form.locator(".alert-enabled").check();
    await form.locator(".alert-threshold").fill("15");
    await form.locator(".alert-low-soc").uncheck();
    await form.locator(".alert-generator").check();
    await form.locator(".alert-webhook").fill("https://hooks.example/e2e-alert");
    await form.locator(".alert-save").click();

    await expect(form.locator(".alert-msg")).toBeVisible();
    await expect(form.locator(".alert-msg")).toHaveText("Alerts saved");
    await expect(form.locator(".alert-msg")).toHaveClass(/alert-ok/);
    await expect(form.locator(".alert-save")).toHaveText("Save alerts");
    await expect(form.locator(".alert-save")).toBeEnabled();

    expect(putRequest).not.toBeNull();
    expect(putRequest.method).toBe("PUT");
    expect(putRequest.body).toEqual({
      enabled: true,
      webhookUrl: "https://hooks.example/e2e-alert",
      lowSocThreshold: 15,
      cooldownMinutes: 60,
      notifyLowSoc: false,
      notifyGenerator: true,
    });
  });

  test("clamps out-of-range threshold to 0–100 on save", async ({ page }) => {
    const form = alertForm(page);
    await form.locator(".alert-enabled").check();
    await form.locator(".alert-threshold").fill("150");
    await form.locator(".alert-webhook").fill("https://hooks.example/clamp-test");
    await form.locator(".alert-save").click();

    await expect(form.locator(".alert-msg")).toHaveText("Alerts saved");

    await page.locator("#detail-back").click();
    await expect(page.locator("#system-detail-modal")).toBeHidden();
    await expect(page.locator("#manage-modal")).toBeVisible();

    await page.locator(".manage-row", { hasText: "Mock Home Solar" }).click();
    await expect(page.locator("#system-detail-modal")).toBeVisible();

    await expect(alertForm(page).locator(".alert-threshold")).toHaveValue("100");
  });
});
