# Project State

_Last updated: 2026-07-08_

## Done

- Reverse-engineered ShineMonitor API (`discovery/API.md`, Python client)
- Reverse-engineered Growatt API (`discovery/growatt/`)
- Static dashboard UI: cards view + animated energy-flow diagram + chart view + compare view
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
- Vitest unit tests for Worker adapters, routes, alerts, history helpers, rate limiting, logger, and HA bridge
- Credential encryption at rest in KV (`CREDENTIALS_KEY`); `credentials.test.js` on Vitest
- Multi-plant picker during system setup
- Inverter status badge on dashboard cards view
- ShineMonitor `BATTERY_SOC` used when API returns valid value
- Intraday power chart (Chart view, canvas, date picker, week strip, prev/next day navigation)
- `GET /api/systems/:id/history` — direct `adapter.fetchHistory` dispatch (vendor-only)
- `GET /api/systems/:id/history/summary` — direct `adapter.fetchHistorySummary` dispatch
- ShineMonitor and Growatt `fetchHistorySummary` for 7-day energy totals + SOC extrema
- PWA manifest and service worker
- 7-day energy bar chart, SOC trend overlay, and CSV export in Chart view
- Chart empty states and error messaging when vendor returns no data
- **Estimated SOC badge** on intraday chart when ShineMonitor SOC is voltage-interpolated
- **Vendor-only history refactor** — KV snapshot layer removed; `history.js` is shared adapter math only
- **Frontend unit tests** — pure helpers extracted to `frontend/lib.js`; Vitest + jsdom
- **Playwright E2E** — setup, dashboard, flow, chart, compare, poll interval, mobile PTR against mock Worker (`e2e/`)
- **CI** — worker + frontend unit + E2E jobs on PR and main; Cloudflare Pages deploy on push to `main` (`.github/workflows/ci.yml`)
- Worker tests for `fetchHistorySummary` (`historySummary.test.js`), alert cron (`scheduled.test.js`), and HTTP fixtures
- **SOC threshold alerts** — Worker cron (`wrangler.toml`), webhook dispatch, manage-systems UI
- **Adapter development guide** — [discovery/ADAPTER_GUIDE.md](./discovery/ADAPTER_GUIDE.md)
- **Worker deployment runbook** — [worker/DEPLOY.md](./worker/DEPLOY.md)
- **Staging Worker environment** — `[env.staging]` in `wrangler.toml`, isolated KV, `npm run deploy:staging`
- **Per-token rate limiting** on realtime data routes (`worker/src/rateLimit.js`)
- **Structured logging / observability** — redaction, adapter error helpers, optional Analytics Engine (`worker/src/logger.js`)
- **Credential rotation UX** — `PUT /api/systems/:id/credentials` + manage-systems form
- **Multi-system comparison view** — side-by-side cards via `/api/systems/all/data`
- **Configurable poll interval** — 30 / 60 / 120 s in manage modal
- **Error toast / retry UI** when poll or chart fetch fails
- **Desktop keyboard shortcut** for refresh (F5 / Ctrl+R)
- **Light theme and high-contrast mode** with system-preference detection
- **Docker Compose local dev** — Miniflare + static file server (`docker-compose.yml`, `scripts/dev-local.js`)
- **Battery time-to-empty estimate** on cards view from load, SOC, and discharge rate
- **Spanish i18n** — en/es string map (`frontend/i18n.js`) with language toggle
- **Growatt weather data** — optional weather strip on cards view
- **Growatt session token in KV** — session cookies stored; plaintext password not persisted after login
- **ShineMonitor multi-device support** — aggregate mode for systems with multiple inverters
- **ShineMonitor automatic re-auth** on token/secret expiry
- **Home Assistant REST bridge** — `GET /api/systems/:id/ha` flat JSON (`worker/src/ha.js`)
- **WebSocket realtime spike** — [discovery/WEBSOCKET_REALTIME.md](./discovery/WEBSOCKET_REALTIME.md) documents defer decision (poll-only vendor APIs)

## In Progress

_None._

## Up Next

_Priority order — close test/i18n gaps from backlog, then product polish and expansion (PLAN.md Phase 4 tail → Phase 5)._

**Backlog (orchestrator-tracked — promote before pickup):**

1. Worker tests for CORS preflight and adapter throw → 502 JSON on data/history routes
2. Playwright E2E for alerts configuration in manage-systems modal
3. Add missing theme i18n keys (`theme`, `themeDark`, `themeLight`, `themeHighContrast`, `themeAria`) in en/es
4. Localize credential rotation form strings in manage modal (currently hardcoded English)
5. Tester coverage for structured logging / observability (`worker/src/logger.js`)

**Ops & hardening:**

6. Always-on `API_TOKEN` and `CREDENTIALS_KEY` in production Worker (ops/config via `wrangler secret put`)
7. Consider fail-closed Worker when `API_TOKEN` is unset outside local dev

**i18n & UX polish:**

8. Localize compare-view card labels and highlight badges (hardcoded English in `app.js`)
9. Localize battery time-to-empty label (`~N left` in `frontend/lib.js`)

**Open product questions (need human input before implementation):**

10. Per-system **Generator vs Grid** label for the grid-input card
11. Configurable **dashboard low-SOC warning** threshold on cards (distinct from alert webhooks)
12. **Generator runtime tracking** — accumulate hours when `grid.active` (session or vendor only)

**Expansion (nice-to-have):**

13. Additional inverter adapter — Victron VRM, Solis, or Deye (discovery pass first)
14. Update **RELEASE_NOTES.md** for v1.2.x shipped features (tags `v1.2.0`, `v1.2.1` exist)
15. Playwright E2E for manage-systems add/remove and credential rotation flows

## Blocked

_None._

## Decisions Made

- **No frontend build step** — plain HTML/CSS/JS with cache-busting `?v=N` params; keeps hosting trivial.
- **Cloudflare Worker as sole backend** — required for Growatt CORS; KV for system configs only; no historical data archive.
- **Normalize at adapter boundary** — frontend consumes one JSON shape regardless of inverter brand.
- **Discover once, poll many** — plant ID, device SN, nominal power captured at setup and stored in KV.
- **Multi-plant selection at setup** — `requiresPlantSelection` flow when account has multiple plants.
- **ShineMonitor SOC** — prefer API `BATTERY_SOC` when valid; voltage interpolation (42.0 V → 0%, 53.5 V → 100%) as fallback; show **Estimated** badge when interpolated on chart.
- **Generator label for grid input** — `grid.active` drives the "Generator" card; suitable for off-grid setups with gen input.
- **Vendor-only history** — charts and summaries fetch from inverter cloud APIs on every request; Worker does not store historical readings in KV.
- **Test strategy** — Worker Vitest (adapters/routes), extracted frontend unit tests (Vitest + jsdom), Playwright E2E against mock Worker; no real inverter credentials in CI.
- **WebSocket push deferred** — `ws.shinemonitor.com` is legacy HTTP, not RFC 6455; HTTP polling + cron alerts remain the transport model.

## Blocked / Open Questions

1. Should frontend and worker share a Cloudflare project or remain independently deployable?
2. ~~Show "estimated" badge when SOC is voltage-interpolated?~~ **Resolved:** badge shown on intraday chart when `socSource` is `estimated` or `mixed`.
3. "Generator" vs "Grid" labeling — configurable per system?
4. ~~Password rotation UX~~ **Resolved:** edit credentials in manage-systems modal via `PUT /api/systems/:id/credentials`.
5. Multi-user access — shared token sufficient or per-user tokens needed?

## Known Risks

- **Upstream API breakage** — ShineMonitor/Growatt can change endpoints without notice; discovery scripts are the first line of detection.
- **Session cache per isolate** — cold Worker starts re-authenticate; acceptable today; Growatt session cookies in KV reduce password exposure.
- **Vendor history gaps** — chart view depends on vendor API availability; no local backfill; empty states mitigate UX impact.
- **Vendor rate limits** — multi-day summary and week navigation require N vendor round-trips; in-memory cache and `days` cap mitigate.
- **Route edge-case coverage** — CORS preflight and some adapter 502 paths lack dedicated worker tests (on backlog).
- **Production secrets** — `API_TOKEN` and `CREDENTIALS_KEY` must be set in production; dev-mode open auth remains a footgun if misconfigured.
- **Partial i18n** — theme selector, credential rotation form, compare view, and time-to-empty strings still English-only in places.
