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
- **PLAN.md** — project definition, roadmap, historical data storage plan
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

## In Progress

- (developer) Add SOC threshold alerts via Worker cron
- (planner) historical data — PLAN.md updated with storage architecture and Phase 3b roadmap

## Up Next

_Priority order from PLAN.md Phase 3b — stored history and extended graphs._

1. Worker cron snapshot job (store normalized realtime every 5–15 min)
2. KV history storage module (write, read, merge, prune with 90-day retention)
3. History API: serve stored data first, vendor `fetchHistory` fallback
4. `GET /api/systems/:id/history/summary?days=7` endpoint
5. 7-day energy bar chart on dashboard
6. SOC trend chart (intraday overlay + 7-day summary)
7. CSV export for chart data
8. History storage unit tests
9. Worker deployment runbook (cron triggers, retention config)
10. Always-on `API_TOKEN` in production (ops/config)

## Blocked

_None._

## Decisions Made

- **No frontend build step** — plain HTML/CSS/JS with cache-busting `?v=N` params; keeps hosting trivial.
- **Cloudflare Worker as sole backend** — required for Growatt CORS; KV for system configs; no separate database.
- **Normalize at adapter boundary** — frontend consumes one JSON shape regardless of inverter brand.
- **Discover once, poll many** — plant ID, device SN, nominal power captured at setup and stored in KV.
- **Multi-plant selection at setup** — `requiresPlantSelection` flow when account has multiple plants.
- **ShineMonitor SOC** — prefer API `BATTERY_SOC` when valid; voltage interpolation (42.0 V → 0%, 53.5 V → 100%) as fallback.
- **Generator label for grid input** — `grid.active` drives the "Generator" card; suitable for off-grid setups with gen input.
- **On-demand history first** — intraday charts fetch from vendor APIs today; Phase 3b adds Worker-owned snapshots.
- **KV for history storage** — daily keys `history:day:<id>:<date>`; 90-day default retention; cron merges realtime polls into day buckets.
- **Stored-first history API** — serve KV snapshots when available; fall back to vendor `fetchHistory` for backfill.

## Blocked / Open Questions

1. Should frontend and worker share a Cloudflare project or remain independently deployable?
2. Show "estimated" badge when SOC is voltage-interpolated?
3. "Generator" vs "Grid" labeling — configurable per system?
4. Password rotation UX — edit credentials in place vs delete/re-add?
5. Multi-user access — shared token sufficient or per-user tokens needed?
6. Snapshot interval — 5 min vs 15 min?
7. History merge — prefer vendor or stored data when both exist?
8. Retention default — 90 days sufficient or configurable?

## Known Risks

- **Upstream API breakage** — ShineMonitor/Growatt can change endpoints without notice; discovery scripts are the first line of detection.
- **Session cache per isolate** — cold Worker starts re-authenticate; acceptable today, may need KV-backed sessions at scale.
- **Vendor history gaps** — mitigated by Phase 3b Worker snapshots; until then, chart view depends on vendor APIs.
- **KV write volume from cron** — batch into single daily key update per snapshot tick to limit writes.
- **No E2E tests** — adapter/route regressions covered by Vitest; full browser flow untested.
