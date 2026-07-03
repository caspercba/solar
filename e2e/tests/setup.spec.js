import { test, expect } from "@playwright/test";
import {
  disableServiceWorker,
  clearAppStorage,
  loginViaSetupForm,
  loginViaDeepLink,
  MOCK_WORKER_URL,
  MOCK_TOKEN,
} from "../helpers.js";

test.beforeEach(async ({ page }) => {
  await disableServiceWorker(page);
  await page.goto("/");
  await clearAppStorage(page);
});

test.describe("Setup screen", () => {
  test("shows error on invalid token", async ({ page }) => {
    await loginViaSetupForm(page, { token: "wrong-token" });

    await expect(page.locator("#setup-screen")).toBeVisible();
    await expect(page.locator("#setup-error")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#setup-error")).toContainText(/invalid token/i);
  });

  test("connects with valid token and shows dashboard", async ({ page }) => {
    await loginViaSetupForm(page);

    await expect(page.locator("#dashboard-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#setup-screen")).toBeHidden();
    await expect(page.locator("#system-tabs")).toBeVisible();
  });

  test("deep-link auto-login works", async ({ page }) => {
    await loginViaDeepLink(page);

    await expect(page.locator("#dashboard-screen")).toBeVisible();
    await expect(page.locator("#system-tabs button")).toHaveCount(2);
  });

  test("persists connection in localStorage", async ({ page }) => {
    await loginViaDeepLink(page);

    const stored = await page.evaluate(() => localStorage.getItem("solar_conn"));
    expect(stored).toBeTruthy();
    const conn = JSON.parse(stored);
    expect(conn.url).toBe(MOCK_WORKER_URL);
    expect(conn.token).toBe(MOCK_TOKEN);
  });
});
