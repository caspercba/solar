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
- **PLAN.md** — project definition and roadmap (vendor-only history policy)
- Root README with architecture and deployment guide
- Credentials redacted from `discovery/growatt/README.md`
- Health check endpoint (`GET /api/health`)
- CORS origin allowlist via `ALLOWED_ORIGINS`
- Vitest unit tests for Worker adapters and routes
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

- (developer) Add SOC threshold alerts via Worker cron
- (planner) update PLAN.md — vendor-only history policy

## Up Next

_Priority order from PLAN.md Phase 3b — vendor-only history refactor._

1. Remove KV history storage module and cron snapshots from Worker
2. Refactor `/api/systems/:id/history` to call `adapter.fetchHistory` directly
3. Refactor `/api/systems/:id/history/summary` to aggregate from vendor APIs
4. Add ShineMonitor `fetchHistorySummary` adapter method
5. Update README to remove KV snapshot documentation
6. Update history unit tests for vendor-only paths
7. Chart empty states for vendor API gaps
8. Always-on `API_TOKEN` in production (ops/config)

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
- **No E2E tests** — adapter/route regressions covered by Vitest; full browser flow untested.
