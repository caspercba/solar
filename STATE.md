# Project State

_Last updated: 2026-07-09_

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
- RELEASE_NOTES.md changelog (v1.0.0–v1.2.1)
- **PLAN.md** — project definition, vendor-only history policy, testing strategy (§7.3); synced to v1.3.0 reality (2026-07-09)
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
- **Playwright E2E** — setup, dashboard, chart, chart navigation, compare view, poll interval, mobile PTR, credential rotation against mock Worker (`e2e/`)
- **CI** — worker + frontend unit + E2E jobs on PR and main; Cloudflare Pages deploy on push to `main`; Worker deploy on release tags (`.github/workflows/ci.yml`)
- Worker tests for `fetchHistorySummary` (`historySummary.test.js`) and alert cron (`scheduled.test.js`)
- HTTP fixtures for vendor parser regression (`worker/test/fixtures/`)
- **SOC threshold alerts** — Worker cron (`wrangler.toml`), webhook dispatch, manage-systems UI
- **Adapter development guide** — [discovery/ADAPTER_GUIDE.md](./discovery/ADAPTER_GUIDE.md)
- **Worker deployment runbook** — [worker/DEPLOY.md](./worker/DEPLOY.md)
- **Multi-day chart navigation** — week strip + prev/next day controls (vendor round-trip per day)
- **Estimated SOC badge** — shown on intraday chart when ShineMonitor SOC is voltage-interpolated
- **Configurable poll interval** — manage-systems modal; persisted in `localStorage`
- **Poll error toast** — retry UI when realtime fetch fails
- **Desktop keyboard refresh** — F5 and Ctrl/Cmd+R trigger poll without full reload
- **Theme modes** — dark (default), light, and high-contrast; persisted preference
- **Per-token rate limiting** — on `/api/systems/:id/data`, `/all/data`, and `/ha` routes
- **Structured logging** — JSON logs with secret redaction (`worker/src/logger.js`); optional Analytics Engine hook
- **ShineMonitor automatic re-auth** — retry once on token/secret expiry (fetchData + fetchHistory)
- **Growatt session cookies in KV** — password migration on login; re-login on 401
- **ShineMonitor multi-device** — discovery, aggregate mode, device picker UI
- **Spanish i18n** — `frontend/i18n.js`; language selector on setup and manage-systems
- **Docker Compose local dev** — mock Worker + static frontend (`docker-compose.yml`, `npm run dev`)
- **Cloudflare Pages auto-deploy** — CI stages and deploys frontend on every push to `main`
- **Staging worker environment** — `[env.staging]` in `wrangler.toml` with isolated KV namespace
- **Multi-system comparison view** — side-by-side cards via `/api/systems/all/data`
- **Battery time-to-empty estimate** — cards view detail from load and SOC
- **Credential rotation UX** — edit portal username/password in manage-systems modal (`PUT /api/systems/:id/credentials`)
- **Home Assistant REST bridge** — `GET /api/systems/:id/ha` flat snake_case payload
- **Growatt weather strip** — optional temperature/condition/irradiance on cards view
- **Victron VRM discovery spike** — `discovery/victron/` (README, API.md, `fetch_data.py`); literature review only, not validated against a live account; see ADR 0001
- **Worker route edge cases** — CORS preflight and adapter 502 paths covered (`auth.test.js`)
- **Planning pass (2026-07-09)** — PLAN.md and STATE.md reconciled against codebase and task board; Phases 1–4 complete at **v1.3.0** tag

## In Progress

_None._

## Up Next

_Priority order after this planning pass. Phases 1–4 are complete; remaining work is §5.3 gaps, release-doc sync, and Phase 5 expansion._

**Awaiting merge (ready on worker branches — orchestrator queue):**

1. Dashboard low-SOC warning threshold on cards (visual badge/style when SOC below `alerts.lowSocThreshold`)
2. Generator runtime tracking when `grid.active` (session-only; no KV archive)
3. Manage-systems modal fix — Close/Save buttons unreachable after low-SOC alert field added
4. Settings section improvements in manage modal
5. Playwright E2E for manage-systems add/remove flow (credential rotation covered; add/remove not)

**Failed — needs retry:**

6. Per-system "Generator" vs "Grid" card label (`sourceLabel` field on system config + manage modal + `fetchData()` echo)

**Still open (not on task board):**

7. Playwright E2E for alerts configuration UI (threshold/webhook form in manage modal)
8. `RELEASE_NOTES.md` — move v1.3.0 feature list from `## Unreleased` to `## v1.3.0` (tag already on `main`)
9. Root `package.json` version bump `1.2.0` → `1.3.0` to match git tag

**Phase 5 expansion (no urgency):**

10. Victron VRM live-account verification, then `worker/src/services/victron.js` (discovery spike done; Solis/Deye unstarted)
11. Configurable generator-detection thresholds (`gridV`/`gridW` constants today)
12. Workers Analytics Engine dataset wiring for production error metrics (logger hook exists; binding commented in `wrangler.toml`)
13. Multi-user access — per-user tokens / audit log (open question; no work started)
14. WebSocket push — evaluated and deferred (`discovery/WEBSOCKET_REALTIME.md`)

## Blocked

_None._

## Decisions Made

- **No frontend build step** — plain HTML/CSS/JS with cache-busting `?v=N` params; keeps hosting trivial.
- **Cloudflare Worker as sole backend** — required for Growatt CORS; KV for system configs only; no historical data archive.
- **Normalize at adapter boundary** — frontend consumes one JSON shape regardless of inverter brand.
- **Discover once, poll many** — plant ID, device SN, nominal power captured at setup and stored in KV.
- **Multi-plant selection at setup** — `requiresPlantSelection` flow when account has multiple plants.
- **Multi-device selection at setup** — `requiresDeviceSelection` flow; optional aggregate mode for multi-inverter plants.
- **ShineMonitor SOC** — prefer API `BATTERY_SOC` when valid; voltage interpolation (42.0 V → 0%, 53.5 V → 100%) as fallback; show "Estimated" badge when interpolated on chart.
- **Generator label for grid input** — `grid.active` drives the "Generator" card; suitable for off-grid setups with gen input. Per-system override via `sourceLabel` (`generator` | `grid`, default `generator`) — decision made; implementation failed once (see Up Next #6).
- **Vendor-only history** — charts and summaries fetch from inverter cloud APIs on every request; Worker does not store historical readings in KV.
- **Test strategy** — Worker Vitest (adapters/routes), extracted frontend unit tests (Vitest + jsdom), Playwright E2E against mock Worker; no real inverter credentials in CI.
- **Growatt sessions in KV** — session cookies persisted; plaintext password removed after first successful login when possible.

## Blocked / Open Questions

1. Should frontend and worker share a Cloudflare project or remain independently deployable? _(Currently independently deployable — Pages for frontend, Workers for backend — and that has worked fine; revisit only if it becomes a pain point.)_
2. Multi-user access — shared token sufficient or per-user tokens needed? _(No work started.)_

## Known Risks

- **Upstream API breakage** — ShineMonitor/Growatt can change endpoints without notice; discovery scripts are the first line of detection.
- **Session cache per isolate** — cold Worker starts re-authenticate; Growatt cookies in KV mitigate password storage but isolate cache still clears on cold start.
- **Vendor history gaps** — chart view depends on vendor API availability; no local backfill; empty states mitigate UX impact.
- **Vendor rate limits** — multi-day summary and week navigation require N vendor round-trips; in-memory cache and `days` cap mitigate; Worker rate limiting protects proxy abuse.
- **Production secrets** — `API_TOKEN` and `CREDENTIALS_KEY` must be set in production; dev-mode open auth remains a footgun if misconfigured (mitigated by fail-closed `PRODUCTION` guard).
- **Release doc lag** — `v1.3.0` is tagged at current `main`, but `RELEASE_NOTES.md` and `package.json` haven't been updated to match (see Up Next #8–9).
- **E2E coverage gap** — alerts configuration form in manage modal has no Playwright spec (see Up Next #7).
- **Failed feature retry** — per-system `sourceLabel` task failed once; needs a fresh attempt with clearer KV/adapter contract (see Up Next #6).
