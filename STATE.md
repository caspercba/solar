# Project State

_Last updated: 2026-07-21 (SOLAR-0121 coordination close)_

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
- **Worker route edge cases** — CORS preflight and adapter 502 paths covered (`auth.test.js`)
- **Planning pass (2026-07-09)** — PLAN.md and STATE.md reconciled against codebase and task board; Phases 1–4 complete at **v1.3.0** tag
- **Multi-user token / audit-log spike** — ADR 0002 (`docs/decisions/0002-multi-user-token-and-audit-log.md`): phased model (shared token default → mutation audit → optional per-user KV keys); JWT and Cloudflare Access as primary auth rejected
- **Generator runtime tracking** — session-only counter (per system, `localStorage`, resets on disconnect) shown on the generator card while `grid.active`
- **Settings hub redesign** — preferences + system list in the settings modal; per-system detail screen
- **Per-system grid input label** — `gridInputLabel` field (`generator` | `grid`, default `generator`)
- **Dashboard low-SOC warning** — card styling and badge when SOC is below `socWarnThreshold`
- **Per-system generator detection thresholds** — configurable `gridDetect` voltage/power minima
- **Release doc sync** — `RELEASE_NOTES.md` has `## v1.3.0`; root `package.json` reads `"version": "1.3.0"`
- **Mutation audit log (ADR 0002 Phase 1)** — `auditLog()` in `worker/src/logger.js`
- **Per-user opaque API keys in KV (ADR 0002 Phase 2)** — `worker/src/tokens.js` + async `checkAuth`
- **Planning pass (2026-07-21)** — ADR 0003 (password users + admin magic-link invites); [ARCHITECTURE.md](./ARCHITECTURE.md) added; PLAN/STATE updated for multi-user accounts (docs only)
- **Victron VRM withdrawn (2026-07-21)** — removed `discovery/victron/`; ADR 0001 withdrawn; Solis/Deye/SMA remain optional Phase 5 candidates
- **Planning pass (2026-07-21, board expansion)** — read PLAN.md §5.3 / §12 Phase 5; created **26** backlog/todo tasks (SOLAR-0125…0150). Split coarse ADR 0003 umbrellas into Worker (0136–0141), Frontend (0125–0131), and Tests (0132–0135); added Solis/Deye/SMA discovery spikes, docs/i18n/logout/security/release follow-ons, and Analytics Engine wiring. Blocked umbrellas SOLAR-0121 / SOLAR-0122 as superseded by granular subtasks.
- **Worker ADR 0003 on `main`** — `users.js`, `invites.js`, `/api/auth/*`, `/api/me`, `/api/admin/users`, `/api/admin/invites` (+ Vitest coverage) landed; prior “no Worker code” gap is closed.
- **Frontend login (SOLAR-0125)** — setup form uses username/password → `POST /api/auth/login`; session bearer stored in `localStorage`; mock Worker + Playwright setup updated.
- **SOLAR-0121 coordination close** — Frontend ADR 0003 umbrella closed **without** implementing remaining UI here; accept-invite, admin users/invites, legacy token paste, logout/i18n stay on SOLAR-0126…0131 / 0145 / 0149.

## In Progress

- (developer) Worker: invite KV registry + hash-only secrets (ADR 0003) — board run in flight
- (developer) Worker: user KV registry + password hashing (ADR 0003) — board run in flight

## Up Next

_Priority order. Phases 1–4 and ADR 0002 Phases 1–2 are complete at v1.3.0. ADR 0003 Worker routes + login screen are on `main`; remaining FE/admin/E2E land via granular tasks. See PLAN.md §5.3, §12, §13 Q6, and ARCHITECTURE.md §3._

**Frontend (PLAN §5.3 — remaining after SOLAR-0121 close):**

1. **SOLAR-0126** — Accept-invite screen (`?invite=` → set username/password → session)
2. **SOLAR-0127** / **0128** — Admin users list + create user with password
3. **SOLAR-0129** / **0130** — Admin mint magic-link invite (copy URL once) + invites list/revoke/purge
4. **SOLAR-0131** — Keep legacy token paste + `?token=` deep links (HA/migration); `?token=` boot path still present after login change
5. **SOLAR-0145** — ES/EN i18n for remaining auth screens
6. **SOLAR-0149** — Logout + session expiry UX

**Worker follow-ons / hardening (if still open on board):**

7. **SOLAR-0136…0141** — confirm registry/route tasks match shipped modules (or archive as done)
8. **SOLAR-0132** — Worker Vitest completeness for users/invites/auth edge cases

**Tests:**

9. **SOLAR-0133** / **0134** / **0135** — Playwright login, admin, legacy-token E2E
10. **SOLAR-0148** — Security review pass

**Docs / release:**

11. **SOLAR-0146** — README / ARCHITECTURE / DEPLOY sync
12. **SOLAR-0150** — Release notes + version bump

**Phase 5 expansion (low priority):**

13. **SOLAR-0142** / **0143** / **0144** — Solis / Deye / SMA discovery spikes
14. **SOLAR-0147** — Optional Analytics Engine binding

**Deferred (no board tasks):**

15. WebSocket push — evaluated and deferred (`discovery/WEBSOCKET_REALTIME.md`)
16. Cloudflare Access on admin/token-minting surfaces (ADR 0002 Phase 3 — implement when requested)
17. Password-reset invite purpose (ADR 0003 later iteration)

## Blocked

- **SOLAR-0121** — Frontend umbrella; **closed as coordination-only** (superseded by SOLAR-0125…0131; no full UI on this parent)
- **SOLAR-0122** — Tests umbrella; superseded by SOLAR-0132…0135 (prefer granular tasks); stays blocked until accept-invite/admin FE exists for Playwright

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
- **Multi-user access — opaque keys (ADR 0002)** — shared `API_TOKEN` remains the default and needs no migration; mutation audit log (Phase 1) and per-user opaque KV keys with `read`/`admin` roles (Phase 2) are both implemented; Cloudflare Access (Phase 3) deferred to admin surfaces only, implement when requested.
- **Multi-user access — password accounts + magic links (ADR 0003)** — Worker user/invite registry + auth/admin routes are on `main`; frontend **login** is on `main`. Remaining FE: accept-invite, admin users/invites panels, legacy token paste UX, logout/session expiry, auth i18n (SOLAR-0126…0131 / 0145 / 0149). No outbound email in v1. Opaque keys and `?token=` retained for machines/migration. See [ARCHITECTURE.md](./ARCHITECTURE.md) and [docs/decisions/0003-password-users-and-magic-link-invites.md](./docs/decisions/0003-password-users-and-magic-link-invites.md).
- **ADR 0003 delivery shape (2026-07-21 planning)** — implement as granular board tasks (Worker → Frontend → Tests), not a single umbrella. **SOLAR-0121** (this parent) is coordination-only and must not absorb the full FE UI while 0125…0131 exist.

## Blocked / Open Questions

1. Should frontend and worker share a Cloudflare project or remain independently deployable? _(Currently independently deployable — Pages for frontend, Workers for backend — and that has worked fine; revisit only if it becomes a pain point.)_
2. Board hygiene — archive or mark done any Worker SOLAR-0136…0141 items that already match shipped `users.js` / `invites.js` / routes, so FE tasks are not falsely blocked.

## Known Risks

- **Upstream API breakage** — ShineMonitor/Growatt can change endpoints without notice; discovery scripts are the first line of detection.
- **Session cache per isolate** — cold Worker starts re-authenticate; Growatt cookies in KV mitigate password storage but isolate cache still clears on cold start.
- **Vendor history gaps** — chart view depends on vendor API availability; no local backfill; empty states mitigate UX impact.
- **Vendor rate limits** — multi-day summary and week navigation require N vendor round-trips; in-memory cache and `days` cap mitigate; Worker rate limiting protects proxy abuse.
- **Production secrets** — `API_TOKEN` and `CREDENTIALS_KEY` must be set in production; dev-mode open auth remains a footgun if misconfigured (mitigated by fail-closed `PRODUCTION` guard).
- **Invite / password sharing** — magic links sent out-of-band can leak; mitigate with TTL, single-use conversion, admin revoke, and hash-only storage (ADR 0003).
- **Last-admin lockout** — user-admin routes must refuse deleting/disabling the final `admin` account.
- **Partial FE for ADR 0003** — login shipped; accept-invite and admin panels not yet; E2E for those flows stays blocked until SOLAR-0126…0130 land.
