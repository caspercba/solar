# Release Notes

## Unreleased

- Nothing yet.

## v1.3.0

### Dashboard & UX

- Add multi-system comparison view for side-by-side monitoring.
- Add Spanish i18n with an EN/ES toggle, persisted in `localStorage`.
- Add light and high-contrast themes with persistent preference.
- Add configurable data refresh (poll) interval in the manage systems modal.
- Add desktop keyboard shortcut to refresh dashboard data.
- Add poll error toast with retry on realtime fetch failures.
- Add battery time-to-empty estimate on cards and flow views.
- Add Growatt weather data to realtime data and cards view.

### Adapters & security

- Add credential rotation UX for existing systems (no more delete/re-add).
- Support ShineMonitor multi-inverter discovery and aggregation.
- Store Growatt session token (`JSESSIONID`) in KV instead of plaintext password; add automatic ShineMonitor re-auth on token expiry.
- Fail closed (deny requests) when `API_TOKEN` is unset in a deployed environment, instead of running open.

### Charts

- Extend multi-day chart navigation with prev/next controls alongside the week strip and swipe gestures.

### Integrations

- Add Home Assistant REST bridge endpoint and integration docs.

### Infrastructure & development

- Add Docker Compose local dev stack with mock Worker and static frontend.
- Various Cloudflare Pages/Worker deploy diagnostics and CI fixes.

## v1.2.1

- Fix Cloudflare Pages deploy to include `frontend/lib.js` in staged assets
  (the extracted helper module was missing from the deployed frontend bundle).

## v1.2.0

### Vendor-only history & charts

- Add intraday power chart view with canvas rendering, date picker, and a new
  `GET /api/systems/:id/history` endpoint.
- Remove KV-based history snapshots and the cron snapshot job; `/history` and
  `/history/summary` now call adapters directly instead of reading stored data
  (vendor-only history policy).
- Add ShineMonitor `fetchHistorySummary` for multi-day energy totals.
- Add 7-day energy bar chart and SOC min/max trend overlay to the Chart view.
- Add CSV export for intraday chart history.
- Add multi-day chart navigation with a week strip and swipe gestures.
- Add an "Estimated" badge on the chart when ShineMonitor SOC is
  voltage-interpolated rather than reported by the API.
- Add chart empty and error states with retry.

### Adapters

- Prefer ShineMonitor's API `BATTERY_SOC` over the voltage estimate when the
  API value is valid.
- Add multi-plant picker during system setup for accounts with multiple plants.
- Show inverter status badge on dashboard cards view.

### Alerts

- Add SOC threshold alerts via a Worker cron trigger with webhook notifications
  and per-system cooldown state.

### Security & hardening

- Restrict CORS to configured frontend origins via `ALLOWED_ORIGINS`.
- Encrypt inverter credentials at rest in KV with AES-GCM (`CREDENTIALS_KEY`).
- Redact credentials from Growatt discovery docs and scripts.
- Add per-token rate limiting on data routes.
- Add structured JSON logging for adapter and alert failures.

### Infrastructure & deployment

- Add root README with architecture overview and deployment guide.
- Add `GET /api/health` endpoint for uptime monitoring.
- Add GitHub Actions CI for worker tests, deploying only on semver release tags.
- Add PWA manifest and service worker for an installable home-screen app.
- Add a staging Worker environment with isolated KV and CI deploy.
- Add Cloudflare Pages auto-deploy for the static frontend.
- Add adapter development guide for new inverter brands and a Worker
  deployment runbook for operators.

### Testing

- Extract frontend pure helpers into `frontend/lib.js` and add Vitest unit
  tests (formatting, CSV export, escaping).
- Migrate `credentials.test.js` from `node:test` to Vitest so the full worker
  suite runs under `@cloudflare/vitest-pool-workers`.
- Add HTTP fixture regression tests for adapter response parsing, and
  `fetchHistorySummary` adapter tests with vendor JSON fixtures.
- Add a Vitest integration test for the Worker's scheduled alert cron handler.
- Add a mock Worker fixture and a Playwright E2E suite against it (setup,
  cards, flow, chart, system modal).
- Extend CI with frontend unit test and Playwright E2E jobs alongside the
  existing worker suite.

## v1.1.0

- Add skeleton shimmer loading state on all card values and progress bars during
  first load and when switching between systems.
- Add pull-to-refresh gesture on the dashboard with visual arrow indicator.
- Use plant timezone offset for device data date queries instead of UTC.
- Add fallback to yesterday's date when today's device data is not yet available.

## v1.0.0

Initial release of the Solar Dashboard.

### Dashboard
- Real-time monitoring cards for Battery (SOC, voltage, current, charge rate),
  Solar (power, PV voltage), Load (power, percent), and Generator (status, power, voltage).
- Energy flow diagram view with animated paths showing power direction between
  solar, battery, generator, and house.
- Cards / Flow view toggle with persistent preference.
- Auto-login via URL query parameters (`proxy`, `token`) for home-screen bookmarks.

### Multi-system support
- Cloudflare Worker proxy with token-based authentication.
- Add, remove, and switch between multiple solar systems.
- ShineMonitor and Growatt service adapters with normalized data output.
- System discovery: automatic detection of plants, devices, and nominal power.

### Infrastructure
- Static frontend (HTML/CSS/JS) with no build step.
- Cloudflare Worker backend with KV storage for system credentials and session
  caching.
- 60-second polling interval with connection status indicator.
