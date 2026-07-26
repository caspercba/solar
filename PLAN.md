# Solar Dashboard — Project Plan

_Last updated: 2026-07-26_

## 1. Project Definition

### 1.1 Purpose

**Solar Dashboard** is a mobile-first web application for monitoring off-grid and hybrid solar power systems in real time. It aggregates data from inverter cloud portals (ShineMonitor/Eybond and Growatt) through a secure server-side proxy, presenting a unified view of battery state, solar production, household load, and generator/grid activity.

The project exists because:

- **CORS blocks direct browser access** to inverter APIs (especially Growatt).
- **Credentials must not live in the browser** — the Cloudflare Worker holds them in KV and authenticates on behalf of the client.
- **Multiple systems** (homes, cabins, remote sites) should be manageable from one dashboard.
- **Multiple human users** — admin invites people (magic link → set password), manages roles, and can create accounts directly; machines keep opaque API keys (ADR 0002 / 0003).
- **No build toolchain** — the frontend is plain HTML/CSS/JS so it can be hosted anywhere (GitHub Pages, Cloudflare Pages, local file server) and updated trivially.

### 1.2 Target Users

| User | Need |
|------|------|
| Homeowner / off-grid resident | Glanceable battery %, solar output, load, generator status on phone |
| Multi-property owner | Switch between systems via tabs |
| Admin (god operator) | Invite users, copy magic links, manage users/roles, revoke invites, create accounts with username/password |
| Invited viewer / helper | Accept magic link, set password, log in with `read` (or granted) role |
| Maintainer / developer | Reverse-engineered API docs, Python discovery scripts, extensible adapter pattern |

### 1.3 Success Criteria

- [x] Connect to proxy with bearer token; credentials never exposed to frontend
- [x] Display normalized real-time data for battery, solar, load, and generator/grid
- [x] Support ShineMonitor and Growatt adapters with automatic plant/device discovery
- [x] Multi-system add/remove/switch
- [x] Cards view and animated energy-flow diagram view
- [x] Mobile UX: pull-to-refresh, skeleton loading, responsive layout
- [x] Intraday power chart (on-demand from vendor APIs)
- [x] **Extended history graphs** — 7-day energy summary, SOC trend, multi-day navigation (all fetched from vendor APIs on demand)
- [x] Production deployment docs (root README + Worker setup + staging runbook)
- [x] Worker unit tests for adapters and API routes (Vitest + Miniflare)
- [x] **Frontend unit tests** — pure helpers (formatting, CSV export, URL parsing) in Vitest + jsdom (`frontend/lib.js`, `frontend/test/`)
- [x] **UI / E2E tests** — Playwright flows against mock Worker (setup, dashboard, chart, chart-nav, manage-credentials, manage-systems, manage-alerts, poll-interval, mobile PTR)
- [x] **CI runs all test suites** — worker + frontend unit + E2E on every PR (`.github/workflows/ci.yml`)
- [x] **Multi-user accounts** — password login, admin magic-link invites (copy URL), invite conversion tracking, user list with roles (ADR 0003)

All of Phase 1–4 (see §12) is complete. **v1.4.0** on `main` ships ADR 0003 (password users + magic-link invites) end-to-end with Worker routes, frontend auth/admin UI, and Playwright coverage; ADR 0002 Phases 1–2 remain in place. Remaining Phase 5 work is optional further adapters (Solis/Deye/SMA — discovery spikes only) and the optional ADR 0002 Phase 3 (Cloudflare Access for admin surfaces, not planned unless requested). Production Worker deploy still needs the `v1.4.0` git tag (CI is tag-gated). See [ARCHITECTURE.md](./ARCHITECTURE.md) for the auth layering overview.

---

## 2. Architecture

Full diagram, KV map, and auth layering: **[ARCHITECTURE.md](./ARCHITECTURE.md)**. Summary:

```
┌─────────────────────────────────────────────────────────────────┐
│  Static Frontend (index.html, app.js, style.css)              │
│  Hosted: GitHub Pages / Cloudflare Pages / any static host      │
│  Storage: localStorage (proxy URL, token, active system, view)  │
│  Auth: username/password login (primary); ?invite= accept;      │
│  legacy paste bearer / ?token=… for HA & migration              │
│  Views: Cards / Flow / Chart (intraday canvas)                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS  Authorization: Bearer <token>
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Cloudflare Worker  (worker/)                                   │
│  • Auth: API_TOKEN + KV opaque keys (ADR 0002) + password       │
│    users / sessions / invites (ADR 0003)                        │
│  • KV namespace SYSTEMS — systems, tokens, users, invites     │
│  • [optional] Cron Trigger — SOC/generator alert evaluation     │
│  • Service adapters: shinemonitor.js, growatt.js                │
│  • In-memory vendor session cache per isolate                   │
└──────────────┬─────────────────────────────┬────────────────────┘
               │                             │
               ▼                             ▼
┌──────────────────────────┐   ┌──────────────────────────────────┐
│  ShineMonitor API        │   │  Growatt API (mqtt.growatt.com)  │
│  web.shinemonitor.com    │   │  Cookie-based JSESSIONID auth    │
│  SHA-1 signed GET        │   │  POST form-urlencoded            │
└──────────────────────────┘   └──────────────────────────────────┘
```

### 2.1 Design Principles

1. **Normalize at the adapter boundary** — frontend only understands one JSON shape.
2. **Discover once, poll many** — plant ID, device SN, nominal power captured at setup; stored in KV.
3. **Fail gracefully** — skeleton UI, status dot, error messages; yesterday fallback for ShineMonitor day data.
4. **Zero build step** — cache-busting via `?v=N` query params on static assets.
5. **Vendor is source of truth for history** — charts and summaries fetch from inverter cloud APIs on demand; the Worker does not archive historical readings in KV.
6. **Auth layers compose** — shared secret, opaque keys (ADR 0002), and password users + admin magic-link invites (ADR 0003) without a third-party IdP or outbound email.

### 2.2 Repository Layout

| Path | Role |
|------|------|
| `index.html` | Setup screen, dashboard cards, flow SVG, chart view, modals |
| `app.js` | API client, polling, rendering, system management, chart canvas |
| `style.css` | Dark theme, cards, flow diagram, chart view, modals, skeleton, PTR |
| `worker/src/index.js` | HTTP router, KV CRUD, adapter dispatch, history routes |
| `worker/src/auth.js` | Bearer token check, CORS helpers |
| `worker/src/credentials.js` | AES-GCM credential encryption/decryption |
| `worker/src/services/shinemonitor.js` | ShineMonitor discover + fetchData + fetchHistory |
| `worker/src/services/growatt.js` | Growatt discover + fetchData + fetchHistory |
| `worker/src/alerts.js` | SOC/generator alert evaluation, cooldown state, webhook dispatch |
| `worker/src/rateLimit.js` | Per-token rate limiting for data routes |
| `worker/src/logger.js` | Structured JSON logging for adapter/alert failures |
| `worker/src/ha.js` | Home Assistant REST bridge (normalized data for HA sensors) |
| `worker/wrangler.toml` | Worker name, KV binding, compatibility date, `[env.staging]`, cron trigger |
| `worker/DEPLOY.md` | Deployment runbook — secrets, KV, staging, cron, production checklist |
| `discovery/` | ShineMonitor API reference + Python client |
| `discovery/growatt/` | Growatt API reference + Python client |
| `discovery/ADAPTER_GUIDE.md` | Guide for adding a new inverter-brand adapter |
| `worker/test/` | Worker unit tests (Vitest + `@cloudflare/vitest-pool-workers`) |
| `frontend/lib.js` | Extracted pure helpers from `app.js` for unit testing |
| `frontend/i18n.js` | EN/ES string tables and `t()` lookup |
| `frontend/test/` | Frontend unit tests (Vitest + jsdom) |
| `e2e/` | Playwright specs + mock Worker fixture |
| `docs/decisions/` | ADRs (opaque tokens/audit, password users + invites; 0001 Victron withdrawn) |
| `ARCHITECTURE.md` | System + auth architecture |
| `RELEASE_NOTES.md` | Version changelog |

---

## 3. Normalized Data Contract

### 3.1 Realtime (`fetchData`)

Every adapter's `fetchData()` returns this shape (frontend `renderData()` expects it):

```json
{
  "systemId": "uuid",
  "name": "My Home Solar",
  "service": "shinemonitor | growatt",
  "timestamp": "2026-07-03 14:32:00",
  "battery": {
    "voltage": 48.2,
    "soc": 72,
    "current": -15,
    "power": -723
  },
  "solar": {
    "power": 1200,
    "voltage": 95
  },
  "load": {
    "power": 850,
    "percent": 24
  },
  "grid": {
    "power": 0,
    "voltage": 0,
    "active": false
  },
  "inverter": {
    "ratedPower": 3500,
    "nominalPV": 5000
  },
  "status": "PV Charging",
  "energyToday": 12.4
}
```

**Sign conventions:**

- Battery `current` negative = charging, positive = discharging (ShineMonitor native; Growatt derived from `batPower / vBat`).
- `grid.active` = generator or grid source detected (`gridV > 30 && |gridW| > 5`).
- ShineMonitor SOC prefers plant-level `BATTERY_SOC` when valid (not `-1`); otherwise estimated from voltage (42.0 V → 0%, 53.5 V → 100%).

### 3.2 Intraday history (`fetchHistory`) — implemented

Adapters expose `fetchHistory(systemConfig, date?)` returning:

```json
{
  "systemId": "uuid",
  "name": "My Home Solar",
  "service": "shinemonitor | growatt",
  "date": "2026-07-03",
  "timezoneOffset": -6,
  "intervalMinutes": 5,
  "points": [
    { "time": "06:00", "solar": 0, "load": 120, "battery": -45 }
  ]
}
```

- **ShineMonitor:** paginated `queryDeviceDataOneDayPaging` → `parseHistoryRows`.
- **Growatt:** `getStorageEnergyDayChart` + `getStorageLineChartData` (battery power overlay).

### 3.3 Multi-day summary (`fetchHistorySummary`) — implemented

Adapters expose `fetchHistorySummary(systemConfig, days?, endDate?)` for bar charts and SOC trends, fetched live from vendor APIs:

```json
{
  "systemId": "uuid",
  "days": 7,
  "series": [
    {
      "date": "2026-07-03",
      "solarKwh": 18.2,
      "loadKwh": 14.1,
      "minSoc": 45,
      "maxSoc": 98
    }
  ]
}
```

- **ShineMonitor:** aggregate daily totals from `fetchHistory` per day (or dedicated plant energy endpoints when available).
- **Growatt:** `getStorageBatChart` for 7-day charge/discharge + SOC min/max.

---

## 4. Worker API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check — returns `{ ok, version }` (no auth required) |
| `GET` | `/api/services` | List supported service types and required fields |
| `GET` | `/api/systems` | List configured systems (id, name, service only) |
| `POST` | `/api/systems` | Add system: `{ service, name?, user, password, plantId? }` → discover + store |
| `DELETE` | `/api/systems/:id` | Remove system from KV |
| `GET` | `/api/systems/:id/data` | Real-time normalized data for one system |
| `GET` | `/api/systems/all/data` | Parallel fetch for all systems |
| `GET` | `/api/systems/:id/history?date=` | Intraday power series (vendor fetch) |
| `GET` | `/api/systems/:id/history/summary?days=7` | Daily energy totals for bar chart (vendor fetch) |
| `POST` | `/api/admin/tokens` | Mint opaque API key (`read` \| `admin`) — admin only (ADR 0002) |
| `GET` | `/api/admin/tokens` | List opaque API keys — admin only |
| `DELETE` | `/api/admin/tokens/:id` | Revoke opaque API key — admin only |

**Auth:** `Authorization: Bearer <token>` — legacy `API_TOKEN` (admin), KV opaque key (`read` / `admin`), or a session bearer from password login / invite accept (bound to a user). If `API_TOKEN` is unset and no KV match, worker runs open (dev only; fails closed when `PRODUCTION` is set).

**Auth routes (ADR 0003):** `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`, `POST /api/auth/invite/accept`, plus admin `/api/admin/users` and `/api/admin/invites` (list/create/revoke/purge). See ADR 0003 for normative behavior.

**Storage (KV):**

- `_index` — JSON array `[{ id, name, service }, ...]`
- `system:<uuid>` — full config including encrypted `credentials` object
- `alert-state:<uuid>` — alert cooldown state (when alerts enabled)
- `token:<hash>` / `_index_tokens` — opaque API keys and user sessions (ADR 0002 / 0003)
- `user:<id>` / `_index_users`, `invite:<hash>` / `_index_invites` (ADR 0003)

---

## 5. Frontend Features

### 5.1 Completed

- [x] **Setup screen** — proxy URL + access token; validates against `GET /api/systems`
- [x] **URL deep-link** — `?proxy=...&token=...` for home-screen bookmarks (params kept in URL)
- [x] **Dashboard cards** — battery SOC bar, solar %, load %, generator badge
- [x] **Flow diagram** — SVG with animated dashed paths; direction reverses for charge/discharge
- [x] **View toggle** — Cards / Flow / Chart; persisted in `localStorage`
- [x] **System tabs** — shown when 2+ systems; single system shows plant name in header
- [x] **Manage systems modal** — add (service picker, multi-plant selection), remove with confirm
- [x] **60 s polling** with connection status dot
- [x] **Pull-to-refresh** on mobile
- [x] **Skeleton shimmer** on first load and system switch
- [x] **Footer** — last update time, today's kWh when available
- [x] **Inverter status badge** — displays `status` field on cards view
- [x] **Intraday chart view** — canvas power chart (solar/load/battery), date picker, legend
- [x] **PWA** — `manifest.json` + service worker for installable home-screen app
- [x] **7-day energy bar chart** — daily solar kWh below intraday chart
- [x] **SOC trend overlay** — min/max SOC on summary days (Growatt `getStorageBatChart`)
- [x] **CSV export** — download day series from chart view
- [x] **Vendor-only history API** — KV snapshot layer removed; `/history` and `/history/summary` call adapters directly
- [x] **ShineMonitor `fetchHistorySummary`** — aggregates last N days from vendor day data
- [x] **Multi-day navigation** — prev/next controls, week strip, and swipe gesture in Chart view
- [x] **"Estimated" badge** — shown when ShineMonitor SOC is voltage-interpolated on intraday chart
- [x] **Chart empty and error states** — with retry, when vendor returns no data for selected date
- [x] Configurable poll interval (manage systems modal)
- [x] Desktop keyboard shortcut for refresh (F5 / Ctrl+R, skipped when a text input is focused)
- [x] Error toast / retry UI when poll fails
- [x] Light theme / high-contrast mode (persisted preference)
- [x] Multi-system comparison view (side-by-side cards, lowest-SOC and generator highlights)
- [x] Spanish i18n with EN/ES toggle, persisted in `localStorage`
- [x] Battery time-to-empty estimate (cards + flow views)
- [x] Growatt weather data on cards view
- [x] Credential rotation UX in manage systems modal (no delete/re-add required)
- [x] Docker Compose local dev stack (mock Worker + static frontend)
- [x] **Generator runtime tracking** — session-only counter (per-system, `localStorage`, resets on disconnect) shown on the generator card while `grid.active`; no KV archive per the vendor-only-history policy.
- [x] **Settings hub redesign** — preferences + system list in the settings modal; per-system detail screen for credentials, grid label, detection thresholds, alerts, and remove
- [x] **Per-system grid input label** — `gridInputLabel` field (`generator` | `grid`, default `generator`) at add time or in manage UI; cards and flow diagram render from it (§13 Q3)
- [x] **Dashboard low-SOC warning on cards** — card styling and badge when SOC is below the user-configured `socWarnThreshold` preference (separate from webhook alert threshold)
- [x] **Per-system generator detection thresholds** — configurable `gridDetect` voltage/power minima in manage UI
- [x] **Chart daily production / consumption tiles** — canvas series + totals under Chart view (same-day vendor history)

### 5.2 Service adapter roadmap — see §6 (ShineMonitor + Growatt shipped; Solis/Deye/SMA optional)

### 5.3 Multi-user accounts & invites (shipped — ADR 0003)

Humans use username/password (or an admin-issued magic link) instead of sharing a long-lived bearer. Machines keep opaque API keys and `?token=` deep links.

- [x] **Login screen** — proxy URL + username/password; store returned session token like today's bearer _(SOLAR-0125)_
- [x] **Accept-invite screen** — `?invite=` → choose username + password → converts invite → logged in _(SOLAR-0126)_
- [x] **Admin: users list** — username, role (`admin` \| `read`), created/last login; remove/disable; change role _(SOLAR-0127)_
- [x] **Admin: create user** — username + password + role (no invite required) _(SOLAR-0128)_
- [x] **Admin: create magic link** — role + optional label/TTL → show URL once → copy to clipboard for out-of-band send _(SOLAR-0129)_
- [x] **Admin: invites list** — emitted vs converted vs revoked/expired; revoke pending; purge stale _(SOLAR-0130)_
- [x] **Keep legacy token path** — `API_TOKEN` / opaque keys / `?token=` / token-paste for HA and migration _(SOLAR-0131)_
- [x] **Worker + E2E tests** — invite lifecycle, last-admin protection, role gates; Playwright login/accept-invite, admin users/invites, legacy-token _(SOLAR-0132…0135)_

Normative design: [docs/decisions/0003-password-users-and-magic-link-invites.md](./docs/decisions/0003-password-users-and-magic-link-invites.md). Architecture sketch: [ARCHITECTURE.md](./ARCHITECTURE.md).

### 5.4 Planned — Cards “Today’s production” tile

Glanceable **current-day** solar production on the Cards landing (not Chart). Approved mock: [docs/mocks/daily-solar-production-tile.png](./docs/mocks/daily-solar-production-tile.png).

- [ ] **Cards tile UI** — full-width amber line sparkline; **kWh total overlaid** (top-left); title “Today’s production”; reuse solar accent (`--accent-sol`)
- [ ] **Data binding** — current calendar day only; series + total kWh from existing vendor history / production helpers (no new KV archive)
- [ ] **i18n + empty/loading** — EN/ES strings; empty/error states consistent with Chart production tile
- [ ] **Tests** — frontend unit helpers if extracted; Playwright asserts tile + total on Cards view

---

## 6. Service Adapters

### 6.1 ShineMonitor (`shinemonitor.js`)

- [x] SHA-1 auth flow with `company-key`
- [x] Discovery: plant list with multi-plant picker support
- [x] Session cache (5 min TTL, per isolate)
- [x] Plant timezone for `date` query parameter
- [x] Fallback to yesterday when today's device data missing
- [x] Field mapping: Charger Power, PV Voltage, PLoad, PGrid, Grid Voltage, Batt Current, Battery Voltage
- [x] Use plant-level `BATTERY_SOC` when not `-1` instead of voltage estimate
- [x] `fetchHistory` — paginated day series via `queryDeviceDataOneDayPaging`
- [x] Multi-device support — discovery and aggregation across multiple inverters per system
- [x] Automatic re-auth on token/secret expiry
- [x] `fetchHistorySummary` — aggregate last N days from vendor day totals

### 6.2 Growatt (`growatt.js`)

- [x] Cookie-based login to `mqtt.growatt.com`
- [x] Discovery: plant list with multi-plant picker support
- [x] Session cache (4 min TTL)
- [x] Status code → human-readable label (STATUS_MAP)
- [x] Real-time + today's PV energy from totals endpoint
- [x] `fetchHistory` — `getStorageEnergyDayChart` + `getStorageLineChartData`
- [x] `fetchSocDailySummary` — `getStorageBatChart` for 7-day charge/discharge + SOC
- [x] Store only session token (`JSESSIONID`) in KV, not plaintext password; re-login on expiry
- [x] `fetchHistorySummary` — daily solar/load kWh from vendor energy endpoints
- [x] Weather data integration

---

## 7. Discovery & Documentation

### 7.1 Completed

- [x] ShineMonitor `API.md` — full endpoint reference with signing algorithm
- [x] ShineMonitor `fetch_plant_json.py` — login + sample queries
- [x] Growatt `API.md` + `fetch_data.py` + README
- [x] Documented CORS limitation motivating the proxy architecture
- [x] Root `README.md` — architecture overview, deploy guide
- [x] Sanitize Growatt README — credentials redacted from examples
- [x] Adapter development guide for adding new inverter brands ([discovery/ADAPTER_GUIDE.md](./discovery/ADAPTER_GUIDE.md))
- [x] Worker deployment runbook ([worker/DEPLOY.md](./worker/DEPLOY.md) — KV, secrets, alerts/cron, production checklist, tag-based CI)

### 7.2 Planned

- [x] Update README to reflect vendor-only history (KV snapshot docs removed; see README "Historical data (vendor APIs)")

### 7.3 Testing

**Goal:** Test as much as we can without compromising the zero-build-step frontend. Worker logic stays in Vitest + Miniflare; frontend pure functions get their own Vitest suite; critical user flows get Playwright E2E against a mock Worker.

#### 7.3.1 Current coverage (Worker)

| Area | File(s) | Status |
|------|---------|--------|
| Auth / CORS | `auth.test.js` | Covered, including preflight and 502 adapter-error cases |
| Credential encryption | `credentials.test.js` | Covered — migrated to Vitest |
| HTTP routes | `routes.test.js` | Covered (health, systems CRUD, auth gate) |
| ShineMonitor adapter | `shinemonitor.test.js` | Covered (signing, SOC resolution, fetchData mock, re-auth) |
| Growatt adapter | `growatt.test.js` | Covered (STATUS_MAP, fetchData mock, session-token storage) |
| History module | `history.test.js`, `historySummary.test.js` | Covered — vendor-only dispatch (KV snapshot layer removed) |
| Alerts | `alerts.test.js`, `scheduled.test.js` | Covered (evaluate, cooldown, webhook dispatch, cron `scheduled()` handler) |
| HTTP fixtures | `fixtures.test.js`, `worker/test/fixtures/` | Covered — recorded vendor JSON for parser regression |
| Rate limiting | `rateLimit.test.js` | Covered |
| Structured logging | `logger.test.js` | Covered |
| Home Assistant bridge | `ha.test.js` | Covered |

**CI today:** `.github/workflows/ci.yml` runs three jobs on every PR and push to `main` — `worker-test`, `frontend-test`, `e2e` (Playwright, Chromium) — plus release-gate/deploy jobs on `v*` tags.

#### 7.3.2 Worker unit tests — closed

All items from the previous gap list have landed: Vitest unification, vendor-only history routes, `fetchHistorySummary` adapter tests, route edge cases, HTTP fixtures, and alert cron integration.

#### 7.3.3 Frontend unit tests — closed

Pure helpers were extracted into `frontend/lib.js` (formatting, CSV export, escaping, SOC/bar math) with a Vitest + jsdom suite under `frontend/test/`.

#### 7.3.4 UI / E2E tests (Playwright) — closed

`e2e/tests/` covers setup, dashboard (cards/flow/compare, tabs, keyboard refresh, toast/retry), chart + chart-nav, credential rotation, manage-systems add/remove, alerts configuration, poll interval, and mobile pull-to-refresh, against a mock Worker fixture (no real inverter credentials in CI).

#### 7.3.5 CI — closed

`worker-test`, `frontend-test`, and `e2e` all run on `pull_request` and `push` to `main`; `release-gate` validates tag format and `deploy-prereq` gates production deploy on all three passing.

#### 7.3.6 Out of scope (for now)

- Visual regression / screenshot diff
- Load testing vendor APIs
- Manual discovery script automation in CI (credentials required)

---

## 8. Security

| Area | Current State | Target |
|------|---------------|--------|
| Proxy access | Bearer token; **fails closed** (denies requests) when `API_TOKEN` unset and `PRODUCTION` secret is set | Done |
| Credential storage | AES-GCM encrypted in KV when `CREDENTIALS_KEY` set; Growatt stores only session token, not plaintext password | Done |
| CORS | `ALLOWED_ORIGINS` allowlist or dev-mode reflect | Done |
| Rate limiting | Per-token rate limits on `/api/systems/*/data` (`worker/src/rateLimit.js`) | Done |
| Discovery scripts | Env-var credentials | Already good; audit for committed secrets |
| Growatt README | Credentials redacted | Done |
| Structured logging | JSON error logs for adapter/alert failures (`worker/src/logger.js`) | Done; Sentry/APM remains optional (README "Sentry and third-party APM") |
| Multi-user access (keys) | Single shared `API_TOKEN` (default), plus optional per-user opaque keys in KV with `read`/`admin` roles | Done (ADR 0002 Phase 2) |
| Multi-user access (accounts) | Password users, admin-issued magic-link invites (copy URL), invite conversion tracking, revoke/purge, admin user CRUD | Done (ADR 0003) |
| Admin audit trail | Mutation-only audit log (`auditLog()` in `worker/src/logger.js`) on system/credential/alert mutations, opaque-token mint/revoke, and user/invite admin actions | Done (ADR 0002 + 0003); persisted sink remains optional |

---

## 9. Infrastructure & Deployment

### 9.1 Current

- Worker: `solar-proxy` on Cloudflare (KV namespace bound in `wrangler.toml`), plus an isolated `solar-proxy-staging` environment with its own KV namespace
- Default proxy URL baked into setup form: `https://solar-proxy.gaspar-solar.workers.dev`
- Frontend: static files, deployed to Cloudflare Pages with auto-deploy from `main`
- GitHub Actions CI runs worker + frontend unit + Playwright E2E on every PR and push to `main`; production deploy gated on all three passing plus a `vMAJOR.MINOR.PATCH` tag
- PWA: `manifest.json` + `sw.js` for offline shell caching
- Cron trigger (`*/5 * * * *`) evaluates SOC/generator alert thresholds and dispatches webhooks

### 9.2 Planned

- [x] GitHub Actions: worker Vitest on PR and main
- [x] GitHub Actions: frontend unit tests + Playwright E2E on PR and main
- [x] Cloudflare Pages for frontend with auto-deploy from `main`
- [x] Staging worker environment
- [x] Health check endpoint (`GET /api/health`)
- [x] **Cron trigger** for SOC/generator alerts only (`wrangler.toml` `[triggers]`)
- [x] Structured logging / error reporting (`worker/src/logger.js`; Workers Analytics Engine and Sentry documented as optional add-ons in README)

---

## 10. Improvements & Ideas

### 10.1 High Impact

1. **Extended vendor history graphs** — 7-day energy bars and SOC trends fetched from inverter APIs on demand; no Worker-side archival.
2. **Credential encryption in KV** — done via `CREDENTIALS_KEY`; ensure production always sets it.
3. **Multi-plant selection** — done at setup via `requiresPlantSelection` flow.
4. **Export data** — CSV download of day series for analysis (done).
4a. **Password users + magic-link invites (ADR 0003)** — done. Primary human onboarding path; admin copies invite links; conversion tracking; revoke/purge; admin user list with roles. Opaque keys (ADR 0002) remain for HA/machines.

### 10.2 Medium Impact

5. **PWA** — done (`manifest.json`, service worker).
6. **Alerts / notifications** — done. Webhook when SOC drops below threshold via Worker cron trigger with per-system cooldown; card-level visual warning in the polled UI via `socWarnThreshold`; E2E coverage for the alerts config form.
7. **Comparison view** — done (`/api/systems/all/data`-backed side-by-side cards, lowest-SOC/generator highlights).
8. **Configurable thresholds** — done for low-battery (`alerts.lowSocThreshold`) and per-system generator-detection sensitivity (`gridDetect` voltage/power minima in manage UI).
9. **i18n** — done. EN/ES toggle, persisted in `localStorage`, covers dashboard, manage modal, themes, and compare view strings.

### 10.3 Nice to Have

10. **Additional adapters** — Solis, Deye, SMA discovery spikes exist under `discovery/`; production adapters still TBD by user need. Victron VRM was spiked then withdrawn (ADR 0001).
11. **Home Assistant integration** — done (`worker/src/ha.js` REST bridge + README integration docs).
12. **Dark/light theme toggle** — done, with persisted preference (system-preference auto-detection not implemented).
13. **WebSocket push** — evaluated and deferred; see `discovery/WEBSOCKET_REALTIME.md`. Decision: keep HTTP polling.
14. **Battery time-to-empty estimate** — done (cards + flow views).
15. **Generator runtime tracking** — done. Session-only counter, per system, persisted in `localStorage`, resets on disconnect (§5.1).
16. **E2E tests** — done for the core flows including alerts config and manage-systems add/remove (§7.3.4).
17. **Docker-compose local dev** — done (`docker-compose.yml`, `scripts/dev-local.js`).
18. **Cards “Today’s production” tile** — planned. Full-width amber sparkline with overlay kWh for the current day only; mock approved in `docs/mocks/daily-solar-production-tile.png` (§5.4).

---

## 11. Version History

| Version | Highlights |
|---------|------------|
| **v1.4.0** (on `main`; cut `v1.4.0` tag to deploy Worker) | Password users + magic-link invites (ADR 0003): login/logout/me, accept-invite, admin users/invites UI, last-admin guard, auth i18n, E2E; opaque keys + audit retained |
| **v1.3.0** | Compare view, i18n (ES), light/high-contrast themes, configurable poll interval, HA REST bridge, keyboard refresh, poll error toast, battery time-to-empty, Growatt weather, credential rotation UX, ShineMonitor multi-device + re-auth, Growatt session-token-only storage, chart multi-day nav polish, Docker Compose dev stack, fail-closed `API_TOKEN` |
| **v1.2.1** | Fix Cloudflare Pages deploy missing `frontend/lib.js` |
| **v1.2.0** | Vendor-only history refactor, ShineMonitor multi-day summary, chart polish |
| **v1.1.0** | Skeleton loading, pull-to-refresh, timezone-aware date queries, yesterday fallback |
| **v1.0.0** | Initial release: cards + flow views, multi-system proxy, ShineMonitor + Growatt adapters |

See [RELEASE_NOTES.md](./RELEASE_NOTES.md) for full changelog.

---

## 12. Roadmap Phases

### Phase 1 — Foundation (Complete)

- [x] Reverse-engineer ShineMonitor API
- [x] Build static dashboard UI (cards + flow)
- [x] Cloudflare Worker proxy with KV storage
- [x] ShineMonitor adapter
- [x] Growatt adapter
- [x] Multi-system management
- [x] Mobile polish (PTR, skeleton, responsive)

### Phase 2 — Documentation & Hardening (Complete)

- [x] Root README with architecture and deploy instructions
- [x] Redact credentials from discovery docs
- [x] Always-on API_TOKEN in production — fails closed when `PRODUCTION` secret is set and `API_TOKEN` is unset
- [x] CORS origin allowlist
- [x] Health check endpoint
- [x] Basic worker unit tests (Vitest + Miniflare)
- [x] Frontend unit tests (extract helpers + Vitest)
- [x] Playwright E2E suite with mock Worker
- [x] CI runs worker + frontend + E2E
- [x] Credential encryption at rest
- [x] GitHub Actions CI/CD (worker + frontend + E2E; tag-gated deploy)

### Phase 3 — Data Depth (Complete)

**3a — On-demand intraday history:**

- [x] Intraday power chart (both adapters)
- [x] `/api/systems/:id/history` endpoint
- [x] Display inverter status on dashboard
- [x] Multi-plant picker during system setup
- [x] Use ShineMonitor `BATTERY_SOC` when valid

**3b — Vendor-only extended graphs:**

- [x] Remove KV history storage and cron snapshots (align code with vendor-only policy)
- [x] Refactor `/history` to call `adapter.fetchHistory` directly (no stored-first merge)
- [x] Refactor `/history/summary` to call `adapter.fetchHistorySummary` (vendor aggregate)
- [x] ShineMonitor `fetchHistorySummary` for 7-day energy totals
- [x] Chart empty states for vendor API gaps
- [x] Update README and tests for vendor-only history

**3c — Test coverage expansion:**

- [x] Fix `credentials.test.js` Vitest compatibility
- [x] Extract `frontend/lib.js` pure helpers from `app.js`
- [x] Frontend unit tests (formatting, CSV, escaping)
- [x] Mock Worker fixture for integration and E2E
- [x] Playwright E2E: setup, cards, flow, chart, system modal, credential rotation, poll interval, mobile PTR
- [x] CI jobs for frontend unit + E2E tests
- [x] Worker tests for `fetchHistorySummary` and alert cron handler

### Phase 4 — Productization (Complete)

- [x] PWA support
- [x] CI/CD pipeline
- [x] SOC threshold alerts (Worker cron + webhook)
- [x] Staging environment

### Phase 5 — Expansion (In Progress — optional adapters only)

- [x] Third-party adapter framework documented (`discovery/ADAPTER_GUIDE.md`)
- [x] Home Assistant bridge
- [x] i18n (ES)
- [ ] Solis / Deye / SMA **production adapters** — discovery spikes done (`discovery/solis/`, `discovery/deye/`, `discovery/sma/`); adapters deferred pending user need (Victron withdrawn — ADR 0001)
- [x] Per-system grid input label (§5.1)
- [x] Dashboard low-SOC warning on cards (§5.1)
- [x] Generator runtime tracking (§5.1)
- [x] E2E coverage for alerts config UI and manage-systems add/remove (§7.3.4)
- [x] Release-notes/version-number sync for v1.3.0 (§11)
- [x] Mutation audit log for admin API routes (ADR 0002 Phase 1)
- [x] Per-user opaque API keys in KV (ADR 0002 Phase 2)
- [x] **Password users + magic-link invites (ADR 0003)** — Worker user/invite registry + auth routes; frontend login + accept-invite; admin users/invites UI; E2E; release notes at v1.4.0 (§5.3)
- [ ] **Cards “Today’s production” tile** — full-width sparkline + overlay kWh for current day only (§5.4; mock in `docs/mocks/`)

---

## 13. Open Questions

1. **Hosting split** — Should frontend and worker share a Cloudflare account/project, or remain independently deployable? _(Still open; current setup keeps them independently deployable — Pages for frontend, Workers for backend.)_
2. **SOC source of truth** — _Resolved._ Prefer API `BATTERY_SOC` when valid; show an "Estimated" badge when voltage-interpolated (implemented).
3. **Generator vs grid** — _Resolved._ Per-system `gridInputLabel` field (`generator` | `grid`, default `generator`) set at add time or in manage UI; cards and flow diagram render from it.
4. **Credential rotation** — _Resolved._ In-place credential rotation UX shipped in the manage-systems modal; no delete/re-add required.
5. **Multi-user access (opaque keys)** — _Resolved (ADR 0002)._ Shared `API_TOKEN` + per-user opaque KV keys (`read` / `admin`), mutation audit log. JWT and third-party IdP rejected as primary auth; Cloudflare Access optional for admin surfaces only.
6. **Multi-user access (password accounts + invites)** — _Resolved (ADR 0003)._ Admin issues copyable magic links; invitees set username/password; revoke/purge and admin user CRUD ship with last-admin protection. No outbound email in v1. Session is a bearer after login. Deep-link `?token=` and opaque keys retained for HA and migration.

---

## 14. Known Risks

| Risk | Mitigation |
|------|------------|
| ShineMonitor/Growatt API changes without notice | Discovery scripts for quick validation; adapter version pinning in responses |
| Worker isolate cold start clears session cache | Re-auth is cheap; consider KV-backed session storage for high-traffic |
| KV credential leak if Worker compromised | Encrypt credentials; minimal secret surface; rotate API_TOKEN |
| Magic-link or password leak via shared chat / URL history | Single-use invites with TTL + admin revoke; hash-store secrets; prefer login over long-lived `?token=` bookmarks for humans |
| Last admin locked out / deleted | Enforce “cannot disable or delete the last admin” on user admin routes |
| Growatt session expiry mid-poll | 4-min cache TTL + retry with re-login on 401 |
| Voltage-based SOC inaccurate | Prefer API SOC; show "estimated" badge when interpolated |
| Vendor history gaps / account offline | Accept limitation; clear empty/error states with retry; yesterday fallback for ShineMonitor realtime |
| Vendor rate limits on multi-day fetches | Cache vendor responses in-memory per isolate; limit summary `days` param |
