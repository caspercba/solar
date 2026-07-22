# Project State

_Last updated: 2026-07-22_

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
- RELEASE_NOTES.md changelog (v1.0.0–v1.3.0)
- **PLAN.md** — project definition, vendor-only history policy, testing strategy (§7.3); synced to ADR 0003 complete (2026-07-22)
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
- **Playwright E2E** — setup, dashboard, chart, chart navigation, compare view, poll interval, mobile PTR, credential rotation, manage-systems add/remove, alerts config, login/accept-invite, admin users/invites, legacy token (`e2e/`)
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
- **Worker route edge cases** — CORS preflight and adapter 502 paths covered (`auth.test.js`)
- **Solis / SMA / Deye discovery spikes** — `discovery/solis/`, `discovery/sma/`, `discovery/deye/`; production adapters deferred pending user need
- **Victron VRM withdrawn** — removed `discovery/victron/`; ADR 0001 withdrawn
- **Generator runtime tracking** — session-only counter (per system, `localStorage`, resets on disconnect)
- **Settings hub redesign** — preferences + system list; per-system detail screen
- **Per-system grid input label** — `gridInputLabel` (`generator` | `grid`, default `generator`)
- **Dashboard low-SOC warning** — card styling/badge below `socWarnThreshold`
- **Per-system generator detection thresholds** — configurable `gridDetect` voltage/power minima
- **Mutation audit log (ADR 0002 Phase 1)** — `auditLog()` in `worker/src/logger.js`
- **Per-user opaque API keys in KV (ADR 0002 Phase 2)** — `worker/src/tokens.js` + async `checkAuth`
- **ADR 0003 complete on `main`** — Worker users/invites/auth/admin routes; frontend login, accept-invite, admin users/invites, legacy token path, auth i18n, logout/session-expiry; Worker Vitest + Playwright E2E (SOLAR-0125…0135, 0145–0149, 0151). Security review SOLAR-0148 done.
- **Release doc sync for v1.3.0** — `RELEASE_NOTES.md` has `## v1.3.0`; root `package.json` reads `"version": "1.3.0"`

## In Progress

- **SOLAR-0153** (planner) — read md files and create new tasks (this pass)
- **SOLAR-0150** (developer) — Release notes + version bump for ADR 0003 (likely v1.4.0); revived after infra dead-letter
- **SOLAR-0154** (developer) — Docs: sync ARCHITECTURE.md to ADR 0003 complete

## Up Next

_Nothing else schedulable on the live board. Solis/Deye/SMA production adapters stay deferred (no board tasks)._

**Deferred (no board tasks):**

1. Solis / Deye / SMA production adapters — discovery spikes done; implement only on user need
2. WebSocket push — evaluated and deferred (`discovery/WEBSOCKET_REALTIME.md`)
3. Cloudflare Access on admin surfaces (ADR 0002 Phase 3 — when requested)
4. Password-reset invite purpose (ADR 0003 later iteration)

## Blocked

_None on the live board._

## Decisions Made

- **No frontend build step** — plain HTML/CSS/JS with cache-busting `?v=N` params; keeps hosting trivial.
- **Cloudflare Worker as sole backend** — required for Growatt CORS; KV for system configs only; no historical data archive.
- **Normalize at adapter boundary** — frontend consumes one JSON shape regardless of inverter brand.
- **Discover once, poll many** — plant ID, device SN, nominal power captured at setup and stored in KV.
- **Multi-plant selection at setup** — `requiresPlantSelection` flow when account has multiple plants.
- **Multi-device selection at setup** — `requiresDeviceSelection` flow; optional aggregate mode for multi-inverter plants.
- **ShineMonitor SOC** — prefer API `BATTERY_SOC` when valid; voltage interpolation (42.0 V → 0%, 53.5 V → 100%) as fallback; show "Estimated" badge when interpolated on chart.
- **Generator label for grid input** — `grid.active` drives the grid/generator card; per-system override via `gridInputLabel` (`generator` | `grid`, default `generator`) in manage UI and at add time.
- **Vendor-only history** — charts and summaries fetch from inverter cloud APIs on every request; Worker does not store historical readings in KV.
- **Test strategy** — Worker Vitest (adapters/routes), extracted frontend unit tests (Vitest + jsdom), Playwright E2E against mock Worker; no real inverter credentials in CI.
- **Growatt sessions in KV** — session cookies persisted; plaintext password removed after first successful login when possible.
- **Multi-user access — opaque keys (ADR 0002)** — shared `API_TOKEN` remains the default; mutation audit log (Phase 1) and per-user opaque KV keys with `read`/`admin` roles (Phase 2) implemented; Cloudflare Access (Phase 3) deferred to admin surfaces only, implement when requested.
- **Multi-user access — password accounts + magic links (ADR 0003)** — Worker + full frontend + E2E on `main` as of 2026-07-22. No outbound email in v1. Opaque keys and `?token=` retained for machines/migration. See [ARCHITECTURE.md](./ARCHITECTURE.md) and [docs/decisions/0003-password-users-and-magic-link-invites.md](./docs/decisions/0003-password-users-and-magic-link-invites.md).

## Blocked / Open Questions

1. Should frontend and worker share a Cloudflare project or remain independently deployable? _(Currently independently deployable — Pages for frontend, Workers for backend — and that has worked fine; revisit only if it becomes a pain point.)_

## Known Risks

- **Upstream API breakage** — ShineMonitor/Growatt can change endpoints without notice; discovery scripts are the first line of detection.
- **Session cache per isolate** — cold Worker starts re-authenticate; Growatt cookies in KV mitigate password storage but isolate cache still clears on cold start.
- **Vendor history gaps** — chart view depends on vendor API availability; no local backfill; empty states mitigate UX impact.
- **Vendor rate limits** — multi-day summary and week navigation require N vendor round-trips; in-memory cache and `days` cap mitigate; Worker rate limiting protects proxy abuse.
- **Production secrets** — `API_TOKEN` and `CREDENTIALS_KEY` must be set in production; dev-mode open auth remains a footgun if misconfigured (mitigated by fail-closed `PRODUCTION` guard).
- **Invite / password sharing** — magic links sent out-of-band can leak; mitigate with TTL, single-use conversion, admin revoke, and hash-only storage (ADR 0003).
- **Last-admin lockout** — user-admin routes must refuse deleting/disabling the final `admin` account.
- **Release gate still in backlog** — SOLAR-0150 was dead-lettered once on VMD infra; human must promote from backlog and confirm a clean re-run before tagging v1.4.0.
