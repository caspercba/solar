# Solar Dashboard — Project Plan

_Last updated: 2026-07-03_

## 1. Project Definition

### 1.1 Purpose

**Solar Dashboard** is a mobile-first web application for monitoring off-grid and hybrid solar power systems in real time. It aggregates data from inverter cloud portals (ShineMonitor/Eybond and Growatt) through a secure server-side proxy, presenting a unified view of battery state, solar production, household load, and generator/grid activity.

The project exists because:

- **CORS blocks direct browser access** to inverter APIs (especially Growatt).
- **Credentials must not live in the browser** — the Cloudflare Worker holds them in KV and authenticates on behalf of the client.
- **Multiple systems** (homes, cabins, remote sites) should be manageable from one dashboard with a single access token.
- **No build toolchain** — the frontend is plain HTML/CSS/JS so it can be hosted anywhere (GitHub Pages, Cloudflare Pages, local file server) and updated trivially.

### 1.2 Target Users

| User | Need |
|------|------|
| Homeowner / off-grid resident | Glanceable battery %, solar output, load, generator status on phone |
| Multi-property owner | Switch between systems via tabs |
| Maintainer / developer | Reverse-engineered API docs, Python discovery scripts, extensible adapter pattern |

### 1.3 Success Criteria

- [x] Connect to proxy with bearer token; credentials never exposed to frontend
- [x] Display normalized real-time data for battery, solar, load, and generator/grid
- [x] Support ShineMonitor and Growatt adapters with automatic plant/device discovery
- [x] Multi-system add/remove/switch
- [x] Cards view and animated energy-flow diagram view
- [x] Mobile UX: pull-to-refresh, skeleton loading, responsive layout
- [x] Intraday power chart (on-demand from vendor APIs)
- [ ] **Extended history graphs** — 7-day energy summary, SOC trend, multi-day navigation (all fetched from vendor APIs on demand)
- [x] Production deployment docs (root README + Worker setup)
- [x] Worker unit tests for adapters and API routes (Vitest + Miniflare)
- [ ] **Frontend unit tests** — pure helpers (formatting, CSV export, URL parsing) in Vitest + jsdom
- [ ] **UI / E2E tests** — Playwright flows against mock Worker (setup, views, chart, system modal)
- [ ] **CI runs all test suites** — worker + frontend unit + E2E on every PR

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Static Frontend (index.html, app.js, style.css)              │
│  Hosted: GitHub Pages / Cloudflare Pages / any static host      │
│  Storage: localStorage (proxy URL, token, active system, view)  │
│  Views: Cards / Flow / Chart (intraday canvas)                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS  Authorization: Bearer <token>
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Cloudflare Worker  (worker/)                                   │
│  • Token auth (API_TOKEN secret)                                │
│  • KV namespace SYSTEMS — system configs + credential index     │
│  • [optional] Cron Trigger — SOC/generator alert evaluation     │
│  • Service adapters: shinemonitor.js, growatt.js                │
│  • In-memory session cache per isolate                          │
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
| `worker/wrangler.toml` | Worker name, KV binding, compatibility date |
| `discovery/` | ShineMonitor API reference + Python client |
| `discovery/growatt/` | Growatt API reference + Python client |
| `worker/test/` | Worker unit tests (Vitest + `@cloudflare/vitest-pool-workers`) |
| `frontend/lib.js` _(planned)_ | Extracted pure helpers from `app.js` for unit testing |
| `frontend/test/` _(planned)_ | Frontend unit tests (Vitest + jsdom) |
| `e2e/` _(planned)_ | Playwright specs + mock Worker fixture |
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

### 3.3 Multi-day summary (`fetchHistorySummary`) — planned

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

**Auth:** `Authorization: Bearer <API_TOKEN>`. If `API_TOKEN` secret is unset, worker runs open (dev only).

**Storage (KV):**

- `_index` — JSON array `[{ id, name, service }, ...]`
- `system:<uuid>` — full config including encrypted `credentials` object
- `alert-state:<uuid>` — alert cooldown state (when alerts enabled)

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

### 5.2 Planned — Extended Vendor History

- [ ] **Vendor-only history API** — remove KV snapshot layer; `/history` and `/history/summary` proxy adapters directly
- [ ] **ShineMonitor `fetchHistorySummary`** — aggregate last N days from vendor day data
- [ ] **Multi-day navigation** — swipe or week strip to browse past days (each day = vendor round-trip)
- [ ] **"Estimated" badge** — when ShineMonitor SOC is voltage-interpolated on intraday chart
- [ ] **Chart empty states** — clear messaging when vendor returns no data for selected date

### 5.3 Planned — Other

- [ ] Configurable poll interval
- [ ] Desktop keyboard shortcut for refresh
- [ ] Error toast / retry UI when poll fails
- [ ] Light theme / high-contrast mode

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
- [ ] Multi-device support (systems with multiple inverters)
- [ ] Handle token/secret expiry with automatic re-auth
- [ ] `fetchHistorySummary` — aggregate last N days from vendor day totals

### 6.2 Growatt (`growatt.js`)

- [x] Cookie-based login to `mqtt.growatt.com`
- [x] Discovery: plant list with multi-plant picker support
- [x] Session cache (4 min TTL)
- [x] Status code → human-readable label (STATUS_MAP)
- [x] Real-time + today's PV energy from totals endpoint
- [x] `fetchHistory` — `getStorageEnergyDayChart` + `getStorageLineChartData`
- [x] `fetchSocDailySummary` — `getStorageBatChart` for 7-day charge/discharge + SOC
- [ ] Store only session token in KV, not plaintext password (re-login on expiry)
- [ ] `fetchHistorySummary` — daily solar/load kWh from vendor energy endpoints
- [ ] Weather data integration (available via Growatt API)

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

### 7.2 Planned

- [ ] Worker deployment runbook (`wrangler secret put`, KV namespace setup, alert cron)
- [ ] Update README to reflect vendor-only history (remove KV snapshot docs)

### 7.3 Testing

**Goal:** Test as much as we can without compromising the zero-build-step frontend. Worker logic stays in Vitest + Miniflare; frontend pure functions get their own Vitest suite; critical user flows get Playwright E2E against a mock Worker.

#### 7.3.1 Current coverage (Worker)

| Area | File(s) | Status |
|------|---------|--------|
| Auth / CORS | `auth.test.js` | Covered |
| Credential encryption | `credentials.test.js` | Covered _(needs Vitest import fix — uses `node:test` today)_ |
| HTTP routes | `routes.test.js` | Covered (health, systems CRUD, auth gate) |
| ShineMonitor adapter | `shinemonitor.test.js` | Covered (signing, SOC resolution, fetchData mock) |
| Growatt adapter | `growatt.test.js` | Covered (STATUS_MAP, fetchData mock) |
| History module | `history.test.js` | Covered _(to be removed/rewritten when KV snapshots deleted)_ |
| Alerts | `alerts.test.js` | Covered (evaluate, cooldown, webhook dispatch mock) |

**CI today:** `.github/workflows/ci.yml` runs `npm test` in `worker/` only.

#### 7.3.2 Gaps — Worker unit tests

- [ ] **Unify on Vitest** — migrate `credentials.test.js` from `node:test` to Vitest so the full suite passes under `@cloudflare/vitest-pool-workers`
- [ ] **Vendor-only history routes** — rewrite `history.test.js` after KV snapshot removal; assert direct `adapter.fetchHistory` / `fetchHistorySummary` dispatch
- [ ] **`fetchHistorySummary` adapters** — ShineMonitor multi-day aggregate; Growatt daily energy totals (Growatt SOC summary partially covered via `fetchSocDailySummary`)
- [ ] **Route edge cases** — invalid system ID, missing date param, adapter throw → 502 JSON, CORS preflight
- [ ] **HTTP fixtures** — recorded vendor response JSON in `worker/test/fixtures/` for parser regression (signing stays unit-tested; row parsing uses fixtures)
- [ ] **Alert cron integration** — `scheduled()` handler invokes `runScheduledAlerts` with mocked fetch + KV

#### 7.3.3 Gaps — Frontend unit tests

`app.js` is a single script with DOM coupling. **Extract pure helpers** into `frontend/lib.js` (or similar) and test without a browser:

| Function | What to assert |
|----------|----------------|
| `fmtW` | kW threshold formatting, rounding |
| `fmtChartDate` | locale-safe date labels |
| `sanitizeExportName` | strips unsafe chars, length cap |
| `csvCell` / `historyToCsv` | RFC-style quoting, BOM-ready output |
| `escapeAttr` | HTML attribute escaping |
| SOC / bar math | solar % from nominal PV, load % fallback |

**Tooling:** root or `frontend/` Vitest config with `happy-dom` or `jsdom`; no bundler required (ESM imports).

#### 7.3.4 Gaps — UI / E2E tests (Playwright)

End-to-end tests validate wiring between `index.html`, `app.js`, and the Worker API contract:

| Flow | Assertions |
|------|------------|
| Setup screen | Invalid token → error; valid mock token → dashboard |
| Cards view | Mock realtime JSON → SOC bar, watts, generator badge |
| Flow view | Charge vs discharge reverses SVG animation class |
| Chart view | History mock → canvas visible; empty mock → empty state |
| View toggle | Cards / Flow / Chart persisted in `localStorage` |
| System modal | Tab switch when 2+ systems (mock list) |
| Pull-to-refresh | Trigger refresh without full page reload _(mobile viewport)_ |

**Mock Worker:** lightweight Miniflare script or static JSON route map in `e2e/fixtures/` — no real inverter credentials in CI.

#### 7.3.5 CI target

```yaml
jobs:
  worker-test:   # existing — vitest in worker/
  frontend-test: # vitest in frontend/ or repo root
  e2e:           # playwright install + e2e/ against mock worker + static server
```

Run all three on `pull_request` and `push` to `main`. E2E may be allowed to retry once on flake.

#### 7.3.6 Out of scope (for now)

- Visual regression / screenshot diff
- Load testing vendor APIs
- Manual discovery script automation in CI (credentials required)

---

## 8. Security

| Area | Current State | Target |
|------|---------------|--------|
| Proxy access | Bearer token (optional in dev) | Always required in production |
| Credential storage | AES-GCM encrypted in KV when `CREDENTIALS_KEY` set | Always encrypted in production |
| CORS | `ALLOWED_ORIGINS` allowlist or dev-mode reflect | Restrict to known frontend origins |
| Rate limiting | None | Per-token rate limits on `/api/systems/*/data` |
| Discovery scripts | Env-var credentials | Already good; audit for committed secrets |
| Growatt README | Credentials redacted | Done |

---

## 9. Infrastructure & Deployment

### 9.1 Current

- Worker: `solar-proxy` on Cloudflare (KV namespace bound in `wrangler.toml`)
- Default proxy URL baked into setup form: `https://solar-proxy.gaspar-solar.workers.dev`
- Frontend: static files; GitHub Actions CI runs worker tests; deploy on version tag
- PWA: `manifest.json` + `sw.js` for offline shell caching

### 9.2 Planned

- [x] GitHub Actions: worker Vitest on PR and main
- [ ] GitHub Actions: frontend unit tests + Playwright E2E on PR and main
- [ ] Cloudflare Pages for frontend with auto-deploy from `main`
- [ ] Staging worker environment
- [x] Health check endpoint (`GET /api/health`)
- [ ] **Cron trigger** for SOC/generator alerts only (`wrangler.toml` `[triggers]`)
- [ ] Structured logging / error reporting (e.g. Workers Analytics, Sentry)

---

## 10. Improvements & Ideas

### 10.1 High Impact

1. **Extended vendor history graphs** — 7-day energy bars and SOC trends fetched from inverter APIs on demand; no Worker-side archival.
2. **Credential encryption in KV** — done via `CREDENTIALS_KEY`; ensure production always sets it.
3. **Multi-plant selection** — done at setup via `requiresPlantSelection` flow.
4. **Export data** — CSV download of day series for analysis (done).

### 10.2 Medium Impact

5. **PWA** — done (`manifest.json`, service worker).
6. **Alerts / notifications** — webhook or email when SOC drops below threshold or generator starts (Worker cron trigger).
7. **Comparison view** — side-by-side cards when multiple systems selected (uses existing `/api/systems/all/data`).
8. **Configurable thresholds** — user-defined low-battery warning level, generator detection sensitivity.
9. **i18n** — Spanish labels (many Growatt/ShineMonitor users in LATAM).

### 10.3 Nice to Have

10. **Additional adapters** — Victron VRM, Solis, Deye, SMA (each needs discovery pass like existing folders).
11. **Home Assistant integration** — expose normalized data via MQTT or REST for HA dashboards.
12. **Dark/light theme toggle** with system preference detection.
13. **WebSocket push** — replace polling when inverter APIs support it (ShineMonitor has `ws.shinemonitor.com`).
14. **Battery time-to-empty estimate** — based on current load and SOC.
15. **Generator runtime tracking** — accumulate hours when `grid.active` is true (session or vendor only; no KV archive).
16. **E2E tests** — Playwright against mock Worker _(planned — see §7.3.4)_.
17. **Docker-compose local dev** — Miniflare + static file server for offline development.

---

## 11. Version History

| Version | Highlights |
|---------|------------|
| **v1.2.0** (planned) | Vendor-only history refactor, ShineMonitor multi-day summary, chart polish |
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
- [ ] Always-on API_TOKEN in production (ops/config, not code)
- [x] CORS origin allowlist
- [x] Health check endpoint
- [x] Basic worker unit tests (Vitest + Miniflare)
- [ ] Frontend unit tests (extract helpers + Vitest)
- [ ] Playwright E2E suite with mock Worker
- [ ] CI runs worker + frontend + E2E
- [x] Credential encryption at rest
- [x] GitHub Actions CI/CD (worker only today)

### Phase 3 — Data Depth (In Progress)

**3a — On-demand intraday history (complete):**

- [x] Intraday power chart (both adapters)
- [x] `/api/systems/:id/history` endpoint
- [x] Display inverter status on dashboard
- [x] Multi-plant picker during system setup
- [x] Use ShineMonitor `BATTERY_SOC` when valid

**3b — Vendor-only extended graphs (next):**

- [ ] Remove KV history storage and cron snapshots (align code with vendor-only policy)
- [ ] Refactor `/history` to call `adapter.fetchHistory` directly (no stored-first merge)
- [ ] Refactor `/history/summary` to call `adapter.fetchHistorySummary` (vendor aggregate)
- [ ] ShineMonitor `fetchHistorySummary` for 7-day energy totals
- [ ] Chart empty states for vendor API gaps
- [ ] Update README and tests for vendor-only history

**3c — Test coverage expansion (parallel):**

- [ ] Fix `credentials.test.js` Vitest compatibility
- [ ] Extract `frontend/lib.js` pure helpers from `app.js`
- [ ] Frontend unit tests (formatting, CSV, escaping)
- [ ] Mock Worker fixture for integration and E2E
- [ ] Playwright E2E: setup, cards, flow, chart, system modal
- [ ] CI jobs for frontend unit + E2E tests
- [ ] Worker tests for `fetchHistorySummary` and alert cron handler

### Phase 4 — Productization

- [x] PWA support
- [x] CI/CD pipeline
- [ ] SOC threshold alerts (Worker cron + webhook) — _in progress_
- [ ] Staging environment

### Phase 5 — Expansion

- [ ] Third-party adapter framework documented
- [ ] Victron or Solis adapter (TBD by user need)
- [ ] Home Assistant bridge
- [ ] i18n (ES)

---

## 13. Open Questions

1. **Hosting split** — Should frontend and worker share a Cloudflare account/project, or remain independently deployable?
2. **SOC source of truth** — For ShineMonitor, prefer API `BATTERY_SOC` when valid (current behavior). Show "estimated" badge when voltage-interpolated?
3. **Generator vs grid** — Current UI labels grid input as "Generator"; some systems are grid-tied without a generator. Should labeling be configurable per system?
4. **Credential rotation** — How should users update passwords without deleting and re-adding a system?
5. **Multi-user access** — Is one shared token sufficient, or do we need per-user tokens / audit log?

---

## 14. Known Risks

| Risk | Mitigation |
|------|------------|
| ShineMonitor/Growatt API changes without notice | Discovery scripts for quick validation; adapter version pinning in responses |
| Worker isolate cold start clears session cache | Re-auth is cheap; consider KV-backed session storage for high-traffic |
| KV credential leak if Worker compromised | Encrypt credentials; minimal secret surface; rotate API_TOKEN |
| Growatt session expiry mid-poll | 4-min cache TTL + retry with re-login on 401 |
| Voltage-based SOC inaccurate | Prefer API SOC; show "estimated" badge when interpolated |
| Vendor history gaps / account offline | Accept limitation; show clear empty states; yesterday fallback for ShineMonitor realtime |
| Vendor rate limits on multi-day fetches | Cache vendor responses in-memory per isolate; limit summary `days` param |
| No frontend or E2E tests | Extract testable helpers; Playwright + mock Worker in CI (§7.3) |
| `credentials.test.js` uses `node:test` | Migrate to Vitest so full worker suite passes in CI |
