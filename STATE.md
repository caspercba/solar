# Project State

_Last updated: 2026-07-03_

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
- Root README with architecture and deployment guide
- Credentials redacted from `discovery/growatt/README.md`
- Health check endpoint (`GET /api/health`)
- CORS origin allowlist via `ALLOWED_ORIGINS`
- Vitest unit tests for Worker adapters, routes, alerts, and history module
- Credential encryption at rest in KV (`CREDENTIALS_KEY`)
- Multi-plant picker during system setup
- Inverter status badge on dashboard cards view
- ShineMonitor `BATTERY_SOC` used when API returns valid value
- Intraday power chart (Chart view, canvas, date picker)
- `GET /api/systems/:id/history` with `fetchHistory` in both adapters
- PWA manifest and service worker
- GitHub Actions CI for worker tests and deploy-on-tag
- KV history storage module, cron snapshots, and stored-first history API _(implemented; pending removal per vendor-only policy)_
- `GET /api/systems/:id/history/summary` endpoint _(currently reads KV; to be refactored to vendor)_
- 7-day energy bar chart, SOC trend overlay, and CSV export in Chart view

## In Progress

- (developer) Remove KV history storage and cron snapshots
- (developer) Add ShineMonitor `fetchHistorySummary` adapter
- (developer) Add SOC threshold alerts via Worker cron

## Up Next

_Priority order — vendor-only history refactor first, then test coverage expansion (PLAN.md Phase 3b → 3c)._

**Vendor-only history (Phase 3b):**

1. Refactor `/api/systems/:id/history` to call `adapter.fetchHistory` directly
2. Refactor `/api/systems/:id/history/summary` to aggregate from vendor APIs
3. Add chart empty states for vendor API gaps
4. Update README to remove KV snapshot documentation
5. Update history unit tests for vendor-only paths

**Test coverage (Phase 3c):**

6. Fix `credentials.test.js` Vitest compatibility (full worker suite green in CI)
7. Extract frontend pure helpers from `app.js` into testable module
8. Add Vitest frontend unit tests (formatting, CSV export, escaping)
9. Add mock Worker fixture for integration and E2E
10. Add Playwright E2E tests (setup, cards, flow, chart, system modal)
11. Extend CI with frontend unit + Playwright jobs
12. Add worker tests for `fetchHistorySummary` adapters and alert cron handler
13. Always-on `API_TOKEN` in production (ops/config)

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
- **Vendor-only history** — charts and summaries fetch from inverter cloud APIs on every request; Worker does not store historical readings in KV. _(Reverses earlier stored-snapshot plan.)_
- **Test strategy** — maximize coverage with Worker Vitest (existing), extracted frontend unit tests (Vitest + jsdom), and Playwright E2E against a mock Worker; no real inverter credentials in CI.

## Blocked / Open Questions

1. Should frontend and worker share a Cloudflare project or remain independently deployable?
2. Show "estimated" badge when SOC is voltage-interpolated?
3. "Generator" vs "Grid" labeling — configurable per system?
4. Password rotation UX — edit credentials in place vs delete/re-add?
5. Multi-user access — shared token sufficient or per-user tokens needed?

## Known Risks

- **Upstream API breakage** — ShineMonitor/Growatt can change endpoints without notice; discovery scripts are the first line of detection.
- **Session cache per isolate** — cold Worker starts re-authenticate; acceptable today, may need KV-backed sessions at scale.
- **Vendor history gaps** — chart view depends on vendor API availability; no local backfill; clear empty states needed.
- **Vendor rate limits** — multi-day summary may require N vendor round-trips; in-memory cache and `days` cap mitigate.
- **No frontend or E2E tests** — adapter/route regressions covered by Worker Vitest; browser flows and DOM rendering untested until Phase 3c.
- **`credentials.test.js` Vitest mismatch** — file uses `node:test`; fails under Vitest pool; CI may report partial failure until fixed.
