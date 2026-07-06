# Project State

_Last updated: 2026-07-06_

## Done

- Reverse-engineered ShineMonitor API (`discovery/API.md`, Python client)
- Reverse-engineered Growatt API (`discovery/growatt/`)
- Static dashboard UI: cards view + animated energy-flow diagram + chart view
- Cloudflare Worker proxy with KV storage and bearer-token auth
- ShineMonitor and Growatt service adapters with normalized data output
- Multi-system add/remove/switch with system tabs
- Mobile UX: pull-to-refresh, skeleton loading, responsive layout
- URL deep-link auto-login (`?proxy=...&token=...`)
- Timezone-aware date queries and yesterday fallback (ShineMonitor)
- RELEASE_NOTES.md changelog (v1.0.0, v1.1.0)
- **PLAN.md** — project definition, vendor-only history policy, testing strategy (§7.3)
- Root README with architecture and deployment guide (vendor-only history documented)
- Credentials redacted from `discovery/growatt/README.md`
- Health check endpoint (`GET /api/health`)
- CORS origin allowlist via `ALLOWED_ORIGINS`
- Vitest unit tests for Worker adapters, routes, alerts, and history helpers
- Credential encryption at rest in KV (`CREDENTIALS_KEY`); `credentials.test.js` on Vitest
- Multi-plant picker during system setup
- Inverter status badge on dashboard cards view
- ShineMonitor `BATTERY_SOC` used when API returns valid value
- Intraday power chart (Chart view, canvas, date picker)
- `GET /api/systems/:id/history` — direct `adapter.fetchHistory` dispatch (vendor-only)
- `GET /api/systems/:id/history/summary` — direct `adapter.fetchHistorySummary` dispatch
- ShineMonitor and Growatt `fetchHistorySummary` for 7-day energy totals + SOC extrema
- PWA manifest and service worker
- 7-day energy bar chart, SOC trend overlay, and CSV export in Chart view
- Chart empty states and error messaging when vendor returns no data
- **Vendor-only history refactor** — KV snapshot layer removed; `history.js` is shared adapter math only
- **Frontend unit tests** — pure helpers extracted to `frontend/lib.js`; Vitest + jsdom
- **Playwright E2E** — setup, dashboard, chart, mobile PTR against mock Worker (`e2e/`)
- **CI** — worker + frontend unit + E2E jobs on PR and main (`.github/workflows/ci.yml`)
- Worker tests for `fetchHistorySummary` (`historySummary.test.js`) and alert cron (`scheduled.test.js`)
- HTTP fixtures for vendor parser regression (`worker/test/fixtures/`)
- **SOC threshold alerts** — Worker cron (`wrangler.toml`), webhook dispatch, manage-systems UI

## In Progress

- (planner) read PLAN.md — planning pass to refresh STATE.md and backlog

## Up Next

_Priority order — finish v1.2.0 chart polish, then productization and UX (PLAN.md Phase 3b tail → Phase 4/5)._

**Chart & history polish (Phase 3b — remaining):**

1. Multi-day navigation in chart view — week strip or swipe between past days (vendor round-trip per day)
2. "Estimated" badge when ShineMonitor SOC is voltage-interpolated on intraday chart

**Documentation & ops:**

3. Worker deployment runbook (`wrangler secret put`, KV setup, alert cron, production checklist)
4. Adapter development guide for adding new inverter brands
5. Always-on `API_TOKEN` and `CREDENTIALS_KEY` in production (ops/config)
6. Cloudflare Pages auto-deploy for frontend from `main`
7. Staging worker environment

**UX & resilience:**

8. Configurable poll interval
9. Error toast / retry UI when poll fails
10. Desktop keyboard shortcut for refresh
11. Light theme / high-contrast mode

**Security & hardening:**

12. Per-token rate limiting on `/api/systems/*/data`
13. Structured logging / error reporting (Workers Analytics or Sentry)

**Adapter improvements:**

14. ShineMonitor automatic re-auth on token/secret expiry
15. Growatt: store session token in KV instead of plaintext password
16. ShineMonitor multi-device support (multiple inverters per system)

**Test gaps:**

17. Worker route edge cases — CORS preflight, adapter throw → 502 JSON
18. Playwright E2E for alerts configuration in manage-systems modal

**Features (medium / nice-to-have):**

19. Multi-system comparison view (side-by-side cards via `/api/systems/all/data`)
20. Credential rotation UX — edit passwords in place without delete/re-add
21. Battery time-to-empty estimate from current load and SOC
22. i18n — Spanish labels
23. Docker-compose local dev (Miniflare + static file server)
24. Growatt weather data integration
25. Home Assistant REST/MQTT bridge
26. WebSocket push when vendor supports realtime streams
27. Additional inverter adapter (Victron VRM, Solis, or Deye — TBD)

## Blocked

_None._

## Decisions Made

- **No frontend build step** — plain HTML/CSS/JS with cache-busting `?v=N` params; keeps hosting trivial.
- **Cloudflare Worker as sole backend** — required for Growatt CORS; KV for system configs only; no historical data archive.
- **Normalize at adapter boundary** — frontend consumes one JSON shape regardless of inverter brand.
- **Discover once, poll many** — plant ID, device SN, nominal power captured at setup and stored in KV.
- **Multi-plant selection at setup** — `requiresPlantSelection` flow when account has multiple plants.
- **ShineMonitor SOC** — prefer API `BATTERY_SOC` when valid; voltage interpolation (42.0 V → 0%, 53.5 V → 100%) as fallback.
- **Generator label for grid input** — `grid.active` drives the "Generator" card; suitable for off-grid setups with gen input.
- **Vendor-only history** — charts and summaries fetch from inverter cloud APIs on every request; Worker does not store historical readings in KV.
- **Test strategy** — Worker Vitest (adapters/routes), extracted frontend unit tests (Vitest + jsdom), Playwright E2E against mock Worker; no real inverter credentials in CI.

## Blocked / Open Questions

1. Should frontend and worker share a Cloudflare project or remain independently deployable?
2. Show "estimated" badge when SOC is voltage-interpolated? _(PLAN proposes yes; UI not built yet.)_
3. "Generator" vs "Grid" labeling — configurable per system?
4. Password rotation UX — edit credentials in place vs delete/re-add?
5. Multi-user access — shared token sufficient or per-user tokens needed?

## Known Risks

- **Upstream API breakage** — ShineMonitor/Growatt can change endpoints without notice; discovery scripts are the first line of detection.
- **Session cache per isolate** — cold Worker starts re-authenticate; acceptable today, may need KV-backed sessions at scale.
- **Vendor history gaps** — chart view depends on vendor API availability; no local backfill; empty states mitigate UX impact.
- **Vendor rate limits** — multi-day summary and week navigation may require N vendor round-trips; in-memory cache and `days` cap mitigate.
- **Route edge-case coverage** — CORS preflight and adapter 502 paths lack dedicated worker tests.
- **Production secrets** — `API_TOKEN` and `CREDENTIALS_KEY` must be set in production; dev-mode open auth remains a footgun if misconfigured.
