import { test, expect } from "@playwright/test";
import {
  disableServiceWorker,
  clearAppStorage,
  loginViaSetupForm,
  loginViaDeepLink,
  waitForHomeData,
  MOCK_WORKER_URL,
  MOCK_TOKEN,
} from "../helpers.js";

test.beforeEach(async ({ page }) => {
  await disableServiceWorker(page);
  await page.goto("/");
  await clearAppStorage(page);
});

test.describe("Setup screen", () => {
  test("shows error on invalid password", async ({ page }) => {
    await loginViaSetupForm(page, { password: "wrong-password" });

    await expect(page.locator("#setup-screen")).toBeVisible();
    await expect(page.locator("#setup-error")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#setup-error")).toContainText(/invalid username or password/i);
  });

  test("shows error for disabled user", async ({ page }) => {
    await loginViaSetupForm(page, { username: "disabled", password: "anything" });

    await expect(page.locator("#setup-screen")).toBeVisible();
    await expect(page.locator("#setup-error")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#setup-error")).toContainText(/invalid username or password/i);
  });

  test("signs in with username/password and shows dashboard", async ({ page }) => {
    await loginViaSetupForm(page);

    await expect(page.locator("#dashboard-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#setup-screen")).toBeHidden();
    await waitForHomeData(page);
    await expect(page.locator(".compare-card")).toHaveCount(2);
  });

  test("password login stores session bearer in localStorage", async ({ page }) => {
    await loginViaSetupForm(page);

    await expect(page.locator("#dashboard-screen")).toBeVisible({ timeout: 15_000 });
    const stored = await page.evaluate(() => localStorage.getItem("solar_conn"));
    expect(stored).toBeTruthy();
    const conn = JSON.parse(stored);
    expect(conn.url).toBe(MOCK_WORKER_URL);
    expect(conn.token).toBe(MOCK_TOKEN);
  });

  test("deep-link auto-login works", async ({ page }) => {
    await loginViaDeepLink(page);

    await expect(page.locator("#dashboard-screen")).toBeVisible();
    await waitForHomeData(page);
    await expect(page.locator(".compare-card")).toHaveCount(2);
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
