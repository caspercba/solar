import { test, expect } from "@playwright/test";
import {
  disableServiceWorker,
  clearAppStorage,
  loginViaDeepLink,
  waitForHomeData,
  openManageModal,
  resetMockAdmin,
  setMockActorRole,
  openInviteDeepLink,
  submitInviteForm,
  MOCK_WORKER_URL,
  MOCK_USER,
} from "../helpers.js";

/**
 * PLAN.md §5.3 / SOLAR-0134 — admin users/invites + last-admin (ADR 0003).
 * Mutates shared mock Worker admin state — run serially and reset between tests.
 */
test.describe.configure({ mode: "serial" });

test.describe("Admin users & invites (ADR 0003)", () => {
  test.beforeEach(async ({ page, request }) => {
    await resetMockAdmin(request);
    await setMockActorRole(request, "admin");
    await disableServiceWorker(page);
    await page.goto("/");
    await clearAppStorage(page);
    await loginViaDeepLink(page);
    await waitForHomeData(page);
  });

  test.afterEach(async ({ request }) => {
    await resetMockAdmin(request);
  });

  test("hides admin surfaces for read role", async ({ page, request }) => {
    await setMockActorRole(request, "read");
    await openManageModal(page);

    await expect(page.locator("#admin-users-list-section")).toBeHidden();
    await expect(page.locator("#admin-invite-section")).toBeHidden();
    await expect(page.locator("#admin-invites-list-section")).toBeHidden();
  });

  test("mints invite, copies URL, and lists pending invite", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openManageModal(page);

    await expect(page.locator("#admin-invite-section")).toBeVisible();
    await page.locator("#invite-label").fill("neighbor Ana");
    await page.locator("#invite-role").selectOption("read");
    await page.locator("#invite-mint-btn").click();

    await expect(page.locator("#invite-result")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#invite-mint-msg")).toContainText(/magic link created/i);

    const inviteUrl = await page.locator("#invite-url").inputValue();
    expect(inviteUrl).toMatch(/[?&]invite=/);
    expect(inviteUrl).toContain("proxy=");

    await page.locator("#invite-copy-btn").click();
    await expect(page.locator("#invite-copy-btn")).toHaveText(/copied/i);

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(inviteUrl);

    const pendingRow = page.locator(".invite-row", { hasText: "neighbor Ana" });
    await expect(pendingRow).toBeVisible();
    await expect(pendingRow.locator(".invite-status-badge")).toHaveText(/pending/i);
    await expect(pendingRow.locator(".invite-revoke-btn")).toBeVisible();
  });

  test("invites list shows conversion after accept", async ({ page }) => {
    await openManageModal(page);

    await page.locator("#invite-label").fill("convert-me");
    await page.locator("#invite-mint-btn").click();
    await expect(page.locator("#invite-result")).toBeVisible({ timeout: 15_000 });

    const inviteUrl = await page.locator("#invite-url").inputValue();
    const secret = new URL(inviteUrl).searchParams.get("invite");
    expect(secret).toBeTruthy();

    await page.locator("#manage-close").click();
    await expect(page.locator("#manage-modal")).toBeHidden();

    await openInviteDeepLink(page, secret);
    await submitInviteForm(page, {
      username: "converted-guest",
      password: "invite-password",
    });
    await expect(page.locator("#dashboard-screen")).toBeVisible({ timeout: 15_000 });

    // Re-auth as admin actor (invite accept issues the shared mock bearer).
    await page.request.post(`${MOCK_WORKER_URL}/__mock__/set-actor`, { data: { role: "admin" } });
    await openManageModal(page);

    const convertedRow = page.locator(".invite-row", { hasText: "convert-me" });
    await expect(convertedRow).toBeVisible();
    await expect(convertedRow.locator(".invite-status-badge")).toHaveText(/converted/i);
    await expect(convertedRow.locator(".invite-revoke-btn")).toHaveCount(0);

    await expect(page.locator(".user-row", { hasText: "converted-guest" })).toBeVisible();
  });

  test("revokes a pending invite", async ({ page }) => {
    await openManageModal(page);

    await page.locator("#invite-label").fill("to-revoke");
    await page.locator("#invite-mint-btn").click();
    await expect(page.locator("#invite-result")).toBeVisible({ timeout: 15_000 });

    const row = page.locator(".invite-row", { hasText: "to-revoke" });
    await expect(row.locator(".invite-status-badge")).toHaveText(/pending/i);

    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toMatch(/revoke/i);
      await dialog.accept();
    });
    await row.locator(".invite-revoke-btn").click();

    await expect(row.locator(".invite-status-badge")).toHaveText(/revoked/i, { timeout: 15_000 });
    await expect(row.locator(".invite-revoke-btn")).toHaveCount(0);
  });

  test("blocks disabling the last admin", async ({ page }) => {
    await openManageModal(page);

    await expect(page.locator("#admin-users-list-section")).toBeVisible();
    const adminRow = page.locator(".user-row", { hasText: MOCK_USER });
    await expect(adminRow).toBeVisible();

    const disableBtn = adminRow.locator(".user-disable-btn");
    await expect(disableBtn).toBeDisabled();
    await expect(disableBtn).toHaveAttribute("title", /cannot disable the last admin/i);

    const readOpt = adminRow.locator(".user-role-select option[value='read']");
    await expect(readOpt).toBeDisabled();
    await expect(readOpt).toHaveAttribute("title", /cannot demote the last admin/i);
  });

  test("creates a user with username, password, and role", async ({ page }) => {
    await openManageModal(page);

    // SOLAR-0128 — admin create-user form (username + password + role, no invite).
    // Expected IDs align with sibling admin sections (#admin-invite-section, etc.).
    const section = page.locator("#admin-create-user-section");
    await expect(section).toBeVisible();

    await section.locator("#create-user-username").fill("direct-user");
    await section.locator("#create-user-pass").fill("password123");
    await section.locator("#create-user-pass-confirm").fill("password123");
    await section.locator("#create-user-role").selectOption("read");
    await section.locator("#create-user-btn").click();

    await expect(page.locator(".user-row", { hasText: "direct-user" })).toBeVisible({
      timeout: 15_000,
    });
    const row = page.locator(".user-row", { hasText: "direct-user" });
    await expect(row.locator(".user-role-select")).toHaveValue("read");
  });
});
