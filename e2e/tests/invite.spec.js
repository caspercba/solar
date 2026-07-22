import { test, expect } from "@playwright/test";
import {
  disableServiceWorker,
  clearAppStorage,
  openInviteDeepLink,
  submitInviteForm,
  uniquePendingInvite,
  MOCK_WORKER_URL,
  MOCK_TOKEN,
  MOCK_INVITE_EXPIRED,
  MOCK_INVITE_REVOKED,
  MOCK_INVITE_USED,
  MOCK_INVITE_INVALID,
} from "../helpers.js";

test.beforeEach(async ({ page }) => {
  await disableServiceWorker(page);
  await page.goto("/");
  await clearAppStorage(page);
});

test.describe("Accept invite (ADR 0003)", () => {
  test("happy path: magic link creates account and shows dashboard", async ({ page }, testInfo) => {
    const invite = uniquePendingInvite(`ok-${testInfo.parallelIndex}-`);
    await openInviteDeepLink(page, invite);
    await submitInviteForm(page, {
      username: `guest-${testInfo.parallelIndex}`,
      password: "invite-password",
    });

    await expect(page.locator("#dashboard-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#invite-screen")).toBeHidden();
    await expect(page.locator("#setup-screen")).toBeHidden();
    await expect(page.locator("#system-tabs")).toBeVisible();

    const stored = await page.evaluate(() => localStorage.getItem("solar_conn"));
    expect(stored).toBeTruthy();
    const conn = JSON.parse(stored);
    expect(conn.url).toBe(MOCK_WORKER_URL);
    expect(conn.token).toBe(MOCK_TOKEN);

    // Invite secret stripped from the address bar after accept.
    expect(page.url()).not.toMatch(/[?&]invite=/);
  });

  test("shows error for invalid invite", async ({ page }) => {
    await openInviteDeepLink(page, MOCK_INVITE_INVALID);
    await submitInviteForm(page, { username: "nobody", password: "invite-password" });

    await expect(page.locator("#invite-screen")).toBeVisible();
    await expect(page.locator("#invite-accept-error")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#invite-accept-error")).toContainText(/invalid/i);
    await expect(page.locator("#dashboard-screen")).toBeHidden();
  });

  test("shows error for expired invite", async ({ page }) => {
    await openInviteDeepLink(page, MOCK_INVITE_EXPIRED);
    await submitInviteForm(page, { username: "latecomer", password: "invite-password" });

    await expect(page.locator("#invite-screen")).toBeVisible();
    await expect(page.locator("#invite-accept-error")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#invite-accept-error")).toContainText(/expired/i);
    await expect(page.locator("#dashboard-screen")).toBeHidden();
  });

  test("shows error for revoked invite", async ({ page }) => {
    await openInviteDeepLink(page, MOCK_INVITE_REVOKED);
    await submitInviteForm(page, { username: "revoked-user", password: "invite-password" });

    await expect(page.locator("#invite-screen")).toBeVisible();
    await expect(page.locator("#invite-accept-error")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#invite-accept-error")).toContainText(/revoked/i);
  });

  test("shows error for already-used invite", async ({ page }) => {
    await openInviteDeepLink(page, MOCK_INVITE_USED);
    await submitInviteForm(page, { username: "second-try", password: "invite-password" });

    await expect(page.locator("#invite-screen")).toBeVisible();
    await expect(page.locator("#invite-accept-error")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#invite-accept-error")).toContainText(/already been used/i);
  });

  test("back link returns to sign-in without accepting", async ({ page }) => {
    await openInviteDeepLink(page, MOCK_INVITE_INVALID);
    await page.locator("#invite-back-btn").click();

    await expect(page.locator("#setup-screen")).toBeVisible();
    await expect(page.locator("#invite-screen")).toBeHidden();
    expect(page.url()).not.toMatch(/[?&]invite=/);
  });
});
