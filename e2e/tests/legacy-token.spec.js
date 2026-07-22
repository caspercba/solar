import { test, expect } from "@playwright/test";
import {
  disableServiceWorker,
  clearAppStorage,
  loginViaDeepLink,
  loginViaTokenPaste,
  loginViaSetupForm,
  MOCK_WORKER_URL,
  MOCK_TOKEN,
} from "../helpers.js";

test.beforeEach(async ({ page }) => {
  await disableServiceWorker(page);
  await page.goto("/");
  await clearAppStorage(page);
});

/**
 * PLAN.md §5.3 / SOLAR-0135 — legacy ?token= deep link and token-paste setup
 * must keep working after password login (ADR 0003).
 */
test.describe("Legacy token path", () => {
  test("?token= deep link reaches dashboard", async ({ page }) => {
    await loginViaDeepLink(page);

    await expect(page.locator("#dashboard-screen")).toBeVisible();
    await expect(page.locator("#setup-screen")).toBeHidden();
    await expect(page.locator("#system-tabs button")).toHaveCount(2);

    const stored = await page.evaluate(() => localStorage.getItem("solar_conn"));
    expect(stored).toBeTruthy();
    const conn = JSON.parse(stored);
    expect(conn.url).toBe(MOCK_WORKER_URL);
    expect(conn.token).toBe(MOCK_TOKEN);
  });

  test("token-paste setup reaches dashboard", async ({ page }) => {
    await loginViaTokenPaste(page);

    await expect(page.locator("#dashboard-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#setup-screen")).toBeHidden();
    await expect(page.locator("#system-tabs")).toBeVisible();

    const stored = await page.evaluate(() => localStorage.getItem("solar_conn"));
    expect(stored).toBeTruthy();
    const conn = JSON.parse(stored);
    expect(conn.url).toBe(MOCK_WORKER_URL);
    expect(conn.token).toBe(MOCK_TOKEN);
  });

  test("token-paste shows error on invalid token", async ({ page }) => {
    await loginViaTokenPaste(page, { token: "not-a-valid-token" });

    await expect(page.locator("#setup-screen")).toBeVisible();
    await expect(page.locator("#setup-error")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#setup-error")).toContainText(/invalid token or proxy url/i);
    await expect(page.locator("#dashboard-screen")).toBeHidden();
  });

  test("setup mode toggle switches between password and token fields", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#setup-screen")).toBeVisible();

    // Default: password mode
    await expect(page.locator("#setup-mode-password")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#setup-password-fields")).toBeVisible();
    await expect(page.locator("#setup-token-fields")).toBeHidden();

    await page.locator("#setup-mode-token").click();
    await expect(page.locator("#setup-mode-token")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#setup-mode-password")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#setup-token-fields")).toBeVisible();
    await expect(page.locator("#setup-password-fields")).toBeHidden();
    await expect(page.locator("#setup-mode-hint")).toBeVisible();

    await page.locator("#setup-mode-password").click();
    await expect(page.locator("#setup-mode-password")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#setup-password-fields")).toBeVisible();
    await expect(page.locator("#setup-token-fields")).toBeHidden();
  });

  test("password login still works alongside token path", async ({ page }) => {
    // Sanity: token paste works, then clear and confirm password login still works.
    await loginViaTokenPaste(page);
    await expect(page.locator("#dashboard-screen")).toBeVisible({ timeout: 15_000 });

    await page.goto("/");
    await clearAppStorage(page);
    await loginViaSetupForm(page);

    await expect(page.locator("#dashboard-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#setup-screen")).toBeHidden();
    await expect(page.locator("#system-tabs")).toBeVisible();
  });
});
