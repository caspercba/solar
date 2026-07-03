# Project State

_Last updated: 2026-07-03_

## Done

- Reverse-engineered ShineMonitor API (`discovery/API.md`, Python client)
- Reverse-engineered Growatt API (`discovery/growatt/`)
- Static dashboard UI: cards view + animated energy-flow diagram
- Cloudflare Worker proxy with KV storage and bearer-token auth
- ShineMonitor and Growatt service adapters with normalized data output
- Multi-system add/remove/switch with system tabs
- Mobile UX: pull-to-refresh, skeleton loading, responsive layout
- URL deep-link auto-login (`?proxy=...&token=...`)
- Timezone-aware date queries and yesterday fallback (ShineMonitor)
- RELEASE_NOTES.md changelog (v1.0.0, v1.1.0)
- **PLAN.md** — detailed project definition, roadmap, and improvement backlog

## In Progress

- (planner) review project write PLAN.md

## Up Next

_Priority order from PLAN.md Phase 2–3._

1. Root README with architecture overview and deployment guide
2. Redact hardcoded credentials from `discovery/growatt/README.md`
3. Health check endpoint (`GET /api/health`)
4. CORS origin allowlist for production frontend
5. Basic worker unit tests (Vitest + Miniflare)
6. Intraday power chart on dashboard (5-min series)
7. Multi-plant picker during system setup
8. Display inverter `status` field on cards view
9. Use ShineMonitor plant-level `BATTERY_SOC` when available (not `-1`)
10. Credential encryption at rest in KV

## Blocked

_None._

## Decisions Made

- **No frontend build step** — plain HTML/CSS/JS with cache-busting `?v=N` params; keeps hosting trivial.
- **Cloudflare Worker as sole backend** — required for Growatt CORS; KV for system configs; no separate database.
- **Normalize at adapter boundary** — frontend consumes one JSON shape regardless of inverter brand.
- **Discover once, poll many** — plant ID, device SN, nominal power captured at setup and stored in KV.
- **First-plant auto-selection** — discovery picks the first plant/device; multi-plant picker deferred to Phase 3.
- **ShineMonitor SOC via voltage interpolation** — used when plant-level `BATTERY_SOC` is unavailable; thresholds 42.0 V (0%) / 53.5 V (100%).
- **Generator label for grid input** — `grid.active` drives the "Generator" card; suitable for off-grid setups with gen input.

## Blocked / Open Questions

1. Should frontend and worker share a Cloudflare project or remain independently deployable?
2. SOC source of truth for ShineMonitor — API value vs voltage estimate?
3. "Generator" vs "Grid" labeling — configurable per system?
4. Password rotation UX — edit credentials in place vs delete/re-add?
5. Multi-user access — shared token sufficient or per-user tokens needed?

## Known Risks

- **Upstream API breakage** — ShineMonitor/Growatt can change endpoints without notice; discovery scripts are the first line of detection.
- **Session cache per isolate** — cold Worker starts re-authenticate; acceptable today, may need KV-backed sessions at scale.
- **Plaintext credentials in KV** — Growatt password stored as-is; encryption planned for Phase 4.
- **Credentials in Growatt README** — real username/password in curl examples; must be redacted.
- **No automated tests** — adapter/route regressions caught manually until Phase 2 tests land.
- **Voltage-based SOC inaccuracy** — may misreport state of charge; prefer API SOC when valid.
