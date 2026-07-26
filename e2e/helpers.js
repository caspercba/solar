import { expect } from "@playwright/test";
import {
  MOCK_TOKEN,
  MOCK_USER,
  MOCK_PASSWORD,
  MOCK_INVITE_EXPIRED,
  MOCK_INVITE_REVOKED,
  MOCK_INVITE_USED,
  MOCK_INVITE_INVALID,
  MOCK_INVITE_PENDING_PREFIX,
  EMPTY_HISTORY_DATE,
  ESTIMATED_SOC_HISTORY_DATE,
} from "./fixtures/payloads.js";

export const MOCK_WORKER_PORT = Number(process.env.MOCK_WORKER_PORT) || 8790;
export const FRONTEND_PORT = Number(process.env.FRONTEND_PORT) || 3456;
export const MOCK_WORKER_URL = `http://127.0.0.1:${MOCK_WORKER_PORT}`;
export {
  MOCK_TOKEN,
  MOCK_USER,
  MOCK_PASSWORD,
  MOCK_INVITE_EXPIRED,
  MOCK_INVITE_REVOKED,
  MOCK_INVITE_USED,
  MOCK_INVITE_INVALID,
  MOCK_INVITE_PENDING_PREFIX,
  EMPTY_HISTORY_DATE,
  ESTIMATED_SOC_HISTORY_DATE,
};

/**
 * Reference "today" for chart/week-strip fixtures (mock history payloads are
 * written against this date). Freezing the browser clock to it keeps
 * date-window assertions (e.g. "2026-07-01" appearing in the week strip)
 * stable regardless of the real wall-clock date the suite runs on.
 */
export const MOCK_TODAY = "2026-07-07T12:00:00Z";

/** Freeze the browser clock so "today" is deterministic for chart/week-strip tests. */
export async function mockToday(page, isoDateTime = MOCK_TODAY) {
  await page.clock.setFixedTime(new Date(isoDateTime));
}

/** Avoid stale service-worker caches interfering with static assets in tests. */
export async function disableServiceWorker(page) {
  await page.addInitScript(() => {
    if (!navigator.serviceWorker) return;
    navigator.serviceWorker.register = () =>
      Promise.reject(new Error("service worker disabled in e2e"));
  });
}

export async function clearAppStorage(page) {
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

export async function loginViaDeepLink(page, token = MOCK_TOKEN) {
  const proxy = encodeURIComponent(MOCK_WORKER_URL);
  const tok = encodeURIComponent(token);
  await page.goto(`/?proxy=${proxy}&token=${tok}`);
  await expect(page.locator("#dashboard-screen")).toBeVisible();
}

export async function loginViaSetupForm(
  page,
  {
    url = MOCK_WORKER_URL,
    username = MOCK_USER,
    password = MOCK_PASSWORD,
  } = {},
) {
  await page.goto("/");
  await expect(page.locator("#setup-screen")).toBeVisible();
  await page.locator("#setup-url").fill(url);
  await page.locator("#setup-user").fill(username);
  await page.locator("#setup-pass").fill(password);
  await page.locator("#setup-btn").click();
}

/**
 * Legacy access-token paste on the setup screen (HA / migration path).
 * Switches the Password | Access Token toggle, fills proxy URL + bearer, submits.
 */
export async function loginViaTokenPaste(
  page,
  {
    url = MOCK_WORKER_URL,
    token = MOCK_TOKEN,
  } = {},
) {
  await page.goto("/");
  await expect(page.locator("#setup-screen")).toBeVisible();
  await page.locator("#setup-mode-token").click();
  await expect(page.locator("#setup-token-fields")).toBeVisible();
  await expect(page.locator("#setup-password-fields")).toBeHidden();
  await page.locator("#setup-url").fill(url);
  await page.locator("#setup-token").fill(token);
  await page.locator("#setup-btn").click();
}

/** Open accept-invite screen via ?proxy=&invite= deep link (ADR 0003). */
export async function openInviteDeepLink(page, invite, { proxy = MOCK_WORKER_URL } = {}) {
  const proxyEnc = encodeURIComponent(proxy);
  const inviteEnc = encodeURIComponent(invite);
  await page.goto(`/?proxy=${proxyEnc}&invite=${inviteEnc}`);
  await expect(page.locator("#invite-screen")).toBeVisible();
  await expect(page.locator("#setup-screen")).toBeHidden();
  await expect(page.locator("#invite-proxy-url")).toHaveValue(proxy.replace(/\/+$/, ""));
}

/** Fill and submit the accept-invite form. */
export async function submitInviteForm(
  page,
  {
    username = "invitee",
    password = "invite-password",
    confirmPassword = password,
  } = {},
) {
  await page.locator("#invite-user").fill(username);
  await page.locator("#invite-pass").fill(password);
  await page.locator("#invite-pass-confirm").fill(confirmPassword);
  await page.locator("#invite-accept-btn").click();
}

/** Unique pending invite secret so parallel specs do not collide on single-use. */
export function uniquePendingInvite(suffix = "") {
  const rand = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${MOCK_INVITE_PENDING_PREFIX}${suffix}${rand}`;
}

/** Reset mock admin users/invites + actor role (shared mock Worker process). */
export async function resetMockAdmin(request) {
  const res = await request.post(`${MOCK_WORKER_URL}/__mock__/reset-admin`);
  expect(res.ok()).toBeTruthy();
}

/** Set GET /api/me role for admin vs read UI gating in E2E. */
export async function setMockActorRole(request, role) {
  const res = await request.post(`${MOCK_WORKER_URL}/__mock__/set-actor`, {
    data: { role },
  });
  expect(res.ok()).toBeTruthy();
}

/** Open Settings/manage modal (systems + admin sections when actor is admin). */
export async function openManageModal(page) {
  await page.locator("#manage-btn").click();
  await expect(page.locator("#manage-modal")).toBeVisible();
}

/** Wait until DETAIL has painted realtime metrics for the active system. */
export async function waitForDashboardData(page) {
  await expect(page.locator("#bat-pct")).not.toHaveText("--");
  await expect(page.locator("#bat-pct")).not.toHaveClass(/skeleton/);
}

/**
 * Wait until HOME summary tiles have settled (at least one non-skeleton tile with data).
 * Compare-as-landing: post-login default is HOME, not Cards.
 */
export async function waitForHomeData(page) {
  await expect(page.locator("#compare-view")).toBeVisible();
  await expect(page.locator(".compare-card").first()).not.toHaveClass(/skeleton/);
  await expect(page.locator(".compare-card .compare-value").first()).not.toHaveText("--%");
}

/** @deprecated Use waitForHomeData — kept as an alias for older call sites. */
export async function waitForCompareData(page) {
  return waitForHomeData(page);
}

/** HOME tile locator for a system name (skeleton or loaded). */
export function homeTile(page, systemName) {
  return page.locator(".compare-card", { hasText: systemName });
}

/**
 * Tap a HOME summary tile to open DETAIL for that system.
 * Default detail subview is Flow (or last persisted cards/flow/chart).
 */
export async function openHomeSystem(page, systemName) {
  const tile = homeTile(page, systemName);
  await expect(tile).toBeVisible();
  await expect(tile).not.toHaveClass(/skeleton/);
  await tile.click();
  await expect(page.locator("#detail-nav")).toBeVisible();
  await expect(page.locator("#detail-system-name")).toHaveText(systemName);
  await expect(page.locator("#compare-view")).toBeHidden();
}

/** Return from DETAIL to HOME via the back control. */
export async function backToHome(page) {
  await page.locator("#detail-back-btn").click();
  await expect(page.locator("#compare-view")).toBeVisible();
  await expect(page.locator("#detail-nav")).toBeHidden();
  await expect(page.locator("#view-toggle")).toBeHidden();
}

/**
 * From HOME, open a system in DETAIL and optionally switch the detail subview.
 * Flow still updates `#bat-pct` in the DOM via renderData, so waitForDashboardData works.
 */
export async function enterSystemDetail(page, systemName, { view } = {}) {
  await openHomeSystem(page, systemName);
  if (view) await switchView(page, view);
  await waitForDashboardData(page);
}

/** Switch DETAIL view tabs (Cards | Flow | Chart). Compare tab was removed. */
export async function switchView(page, view) {
  const tabId = view === "flow"
    ? "#tab-flow"
    : view === "chart"
      ? "#tab-chart"
      : "#tab-cards";
  await expect(page.locator("#view-toggle")).toBeVisible();
  await page.locator(tabId).click();
}

/** Simulate a horizontal swipe on the chart area (requires hasTouch / mobile project). */
export async function swipeChartDay(page, { direction = "prev", distance = 120 } = {}) {
  const area = page.locator("#chart-swipe-area");
  const box = await area.boundingBox();
  if (!box) throw new Error("chart-swipe-area not visible");
  const y = Math.round(box.y + box.height / 2);
  const centerX = Math.round(box.x + box.width / 2);
  const endX = direction === "prev" ? centerX + distance : centerX - distance;

  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: x == null ? [] : [{ x, y }],
    });

  await touch("touchStart", centerX);
  for (let x = centerX; direction === "prev" ? x <= endX : x >= endX; x += direction === "prev" ? 10 : -10) {
    await touch("touchMove", x);
  }
  await touch("touchEnd");
}

/** Simulate a downward pull on the dashboard (requires hasTouch / mobile project). */
export async function pullToRefresh(page, { pullDistance = 120 } = {}) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await page.locator("#dashboard-screen").boundingBox();
  if (!box) throw new Error("dashboard-screen not visible");
  const x = Math.round(box.x + box.width / 2);
  const startY = Math.round(box.y + 80);
  const endY = startY + pullDistance;

  const cdp = await page.context().newCDPSession(page);
  const touch = (type, y) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: y == null ? [] : [{ x, y }],
    });

  await touch("touchStart", startY);
  for (let y = startY + 10; y <= endY; y += 10) {
    await touch("touchMove", y);
  }
  await touch("touchEnd");
}
