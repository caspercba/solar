# Project State

_Last updated: 2026-07-11_

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
- **Playwright E2E** — setup, dashboard, chart, chart navigation, compare view, poll interval, mobile PTR, credential rotation, manage-systems add/remove, and alerts configuration against mock Worker (`e2e/`)
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
- **Planning pass (2026-07-09)** — PLAN.md and STATE.md reconciled against codebase and task board; Phases 1–4 complete at **v1.3.0** tag; confirmed via repo inspection (git tags, file tree, test files) rather than assumed from the prior doc snapshot
- **Multi-user token / audit-log spike** — ADR 0002 (`docs/decisions/0002-multi-user-token-and-audit-log.md`): phased model (shared token default → mutation audit → optional per-user KV keys); JWT and Cloudflare Access as primary auth rejected
- **Generator runtime tracking** — session-only counter (per system, `localStorage`, resets on disconnect) shown on the generator card while `grid.active`; no vendor/KV history involved (PLAN §5.1, §10.3.15)
- **Settings hub redesign** — preferences + system list in the settings modal; per-system detail screen for credentials, grid label, detection thresholds, alerts, and remove
- **Per-system grid input label** — `gridInputLabel` field (`generator` | `grid`, default `generator`) set at add time or in manage UI; cards and flow diagram render from it
- **Dashboard low-SOC warning** — card styling and badge when SOC is below the user-configured `socWarnThreshold` preference (separate from webhook alert threshold)
- **Per-system generator detection thresholds** — configurable `gridDetect` voltage/power minima in manage UI (`PUT /api/systems/:id/grid-detect`)
- **Release doc sync** — `RELEASE_NOTES.md` has `## v1.3.0`; root `package.json` reads `"version": "1.3.0"`
- **Mutation audit log (ADR 0002 Phase 1)** — `auditLog()` in `worker/src/logger.js`; structured `audit` JSON entries (actorId, action, resource, method, path, clientIp, outcome, status, requestId) on `POST /api/systems`, `PUT /api/systems/:id/credentials`, `PUT /api/systems/:id/alerts`, `DELETE /api/systems/:id`, `POST /api/admin/tokens`, `DELETE /api/admin/tokens/:id`; read routes unaffected; `actorId` is `"shared"` for the legacy token or the caller's own token id for per-user keys; reuses existing `logger.js` redaction rules; tests in `routes.test.js`
- **Per-user opaque API keys in KV (ADR 0002 Phase 2)** — `worker/src/tokens.js`: SHA-256-hashed token registry (`token:<hash>`, `token-id:<id>`, `_index_tokens`), opaque 32-byte base64url tokens, `read`/`admin` roles, optional `expiresAt`, revoke-by-id. `checkAuth` (`worker/src/auth.js`) is now async: legacy `API_TOKEN` checked first as a no-KV-read fast path resolving to `actorId: "shared"`/`admin` (no migration needed — it keeps working unchanged); falls back to KV lookup for per-user tokens, rejecting revoked/expired entries. All mutating routes (`POST`/`PUT`/`DELETE`) return `403` for `read`-role callers. New admin-only routes: `POST`/`GET /api/admin/tokens`, `DELETE /api/admin/tokens/:id` — minting requires an existing `admin` token (no separate bootstrap secret). Rate-limit keying (`worker/src/rateLimit.js`) now gates off `auth.openMode` (true only in the true no-token-configured dev case) instead of `env.API_TOKEN` presence, so KV-only deployments are still rate-limited. Tests: `tokens.test.js`, `auth.test.js` (revoked/expired coverage), `routes.test.js` (role enforcement, independent revoke, admin token routes), `rateLimit.test.js`.

## In Progress

_None._

## Up Next

_Priority order after this planning pass. Phases 1–4 are complete at v1.3.0; ADR 0002 Phases 1–2 are also complete. Remaining work is Phase 5 expansion. See PLAN.md §5.2, §12, and §13 for full detail._

**Phase 5 expansion (no urgency):**

1. Victron VRM adapter implementation — discovery spike complete (`discovery/victron/`); next step is live verification against a real VRM account before `worker/src/services/victron.js` is written; Solis/Deye/SMA remain unstarted
2. WebSocket push — evaluated and deferred (`discovery/WEBSOCKET_REALTIME.md`); revisit only if polling proves insufficient
3. Optional Workers Analytics Engine dataset wiring for production error metrics (logger hook exists; binding commented in `wrangler.toml`)

**Deferred (ADR 0002 Phase 3 — implement when requested):**

4. Cloudflare Access on admin/token-minting surfaces (operator hardening only, not primary auth)

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
- **Generator label for grid input** — `grid.active` drives the grid/generator card; per-system override via `gridInputLabel` (`generator` | `grid`, default `generator`) in manage UI and at add time.
- **Vendor-only history** — charts and summaries fetch from inverter cloud APIs on every request; Worker does not store historical readings in KV.
- **Test strategy** — Worker Vitest (adapters/routes), extracted frontend unit tests (Vitest + jsdom), Playwright E2E against mock Worker; no real inverter credentials in CI.
- **Growatt sessions in KV** — session cookies persisted; plaintext password removed after first successful login when possible.
- **Multi-user access (ADR 0002)** — shared `API_TOKEN` remains the default and needs no migration; mutation audit log (Phase 1) and per-user opaque KV keys with `read`/`admin` roles (Phase 2) are both implemented; Cloudflare Access (Phase 3) deferred to admin surfaces only, implement when requested.

## Blocked / Open Questions

1. Should frontend and worker share a Cloudflare project or remain independently deployable? _(Currently independently deployable — Pages for frontend, Workers for backend — and that has worked fine; revisit only if it becomes a pain point.)_

## Known Risks

- **Upstream API breakage** — ShineMonitor/Growatt can change endpoints without notice; discovery scripts are the first line of detection.
- **Session cache per isolate** — cold Worker starts re-authenticate; Growatt cookies in KV mitigate password storage but isolate cache still clears on cold start.
- **Vendor history gaps** — chart view depends on vendor API availability; no local backfill; empty states mitigate UX impact.
- **Vendor rate limits** — multi-day summary and week navigation require N vendor round-trips; in-memory cache and `days` cap mitigate; Worker rate limiting protects proxy abuse.
- **Production secrets** — `API_TOKEN` and `CREDENTIALS_KEY` must be set in production; dev-mode open auth remains a footgun if misconfigured (mitigated by fail-closed `PRODUCTION` guard).
