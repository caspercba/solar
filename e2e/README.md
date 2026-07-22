# E2E tests (Playwright)

Browser tests for the Solar Dashboard static frontend against a **mock Worker** — no real inverter credentials or secrets.

## Prerequisites

- Node.js 20+
- Chromium — installed automatically at runtime, no baked image required. `npm test`'s `pretest` hook runs `scripts/ensure-browser.js`, which tries `npx playwright install --with-deps chromium` (root/sudo, e.g. CI) and falls back to a browser-only install plus `scripts/fetch-deps.js` (downloads minimal runtime libraries into `e2e/.deps/`, no root needed) when `--with-deps` isn't available.

## Quick start

From the repository root:

```bash
# Docker (recommended) — mock Worker + dashboard
npm run dev
# open http://localhost:8080 — proxy http://localhost:8787, user e2e-user / e2e-password
# (legacy deep-link still accepts token e2e-test-token)
```

Or run Playwright tests only:

```bash
cd e2e
npm ci
npm test
```

Playwright starts two local servers automatically:

| Service | Default URL | Purpose |
|---------|-------------|---------|
| Mock Worker | `http://127.0.0.1:8790` | JSON API (`fixtures/mock-worker.js`) |
| Static frontend | `http://127.0.0.1:3456` | Serves repo root (`index.html`, `app.js`, …) |

Mock password login: `e2e-user` / `e2e-password` → session bearer `e2e-test-token` (defined in `fixtures/payloads.js`).

Mock invite accept (`POST /api/auth/invite/accept`): secrets with prefix `e2e-pending-` succeed once; `e2e-expired-invite`, `e2e-revoked-invite`, `e2e-used-invite`, and other values map to Worker-style error responses.

## Manual server mode

Useful while debugging a single spec:

```bash
# Terminal 1 — mock API
cd e2e && node fixtures/mock-worker.js

# Terminal 2 — static site (from repo root)
npx serve -l 3456 .

# Terminal 3 — run tests (reuse running servers)
cd e2e && CI= npm test
```

Set `CI=1` to skip `fetch-deps.js`'s user-space library bootstrap and rely on system libraries from `playwright install-deps` (still runs `ensure-browser.js` to make sure the browser itself is installed).

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MOCK_WORKER_PORT` | `8790` | Mock Worker listen port |
| `MOCK_WORKER_HOST` | `127.0.0.1` | Bind address (`0.0.0.0` in Docker) |
| `FRONTEND_PORT` | `3456` | Static file server port |
| `MOCK_WORKER_TOKEN` | `e2e-test-token` | Session bearer returned by login / accepted on protected routes |
| `MOCK_WORKER_USER` | `e2e-user` | Username for `POST /api/auth/login` |
| `MOCK_WORKER_PASSWORD` | `e2e-password` | Password for `POST /api/auth/login` |

## Test coverage

| Spec | Flows |
|------|-------|
| `tests/setup.spec.js` | Invalid password / disabled user errors, password login, deep-link auto-login |
| `tests/legacy-token.spec.js` | Legacy `?token=` deep link, token-paste setup, invalid token error, mode toggle alongside password login |
| `tests/invite.spec.js` | Accept-invite happy path; invalid / expired / revoked / used invite errors |
| `tests/dashboard.spec.js` | Cards SOC/watts, flow charge/discharge classes, system tabs, view toggle `localStorage` |
| `tests/chart.spec.js` | History chart with mock data, empty state for date `2026-01-01` |
| `tests/mobile-ptr.spec.js` | Pull-to-refresh smoke (mobile viewport) |

Projects: **desktop-chrome** and **mobile-chrome** (Pixel 5).

## Useful commands

```bash
npm run test:ci      # Playwright only (CI / after install-deps)
npm run test:ui      # Playwright UI mode
npm run test:headed  # Visible browser
npx playwright test tests/setup.spec.js   # Single file
npx playwright show-report                # After a failed run with traces
```

## Mock data notes

- Two systems: **Mock Home Solar** (charging, 72% SOC) and **Mock Cabin** (discharging, 45% SOC).
- Intraday history returns sample points for `2026-07-03`.
- Date `2026-01-01` returns **empty** `points[]` to exercise chart empty-state UI.

See `fixtures/payloads.js` for normalized JSON shapes matching `PLAN.md`.

## CI (GitHub Actions)

```bash
cd e2e
npm ci
npx playwright install --with-deps chromium
npm run test:ci
```

Use `test:ci` in CI so `pretest` (browser + Debian library bootstrap) doesn't run twice — the explicit `playwright install --with-deps chromium` step already covers it.
