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
- [ ] **Persistent historical storage** — Worker snapshots data; graphs survive vendor API gaps
- [ ] **Extended history graphs** — 7-day energy summary, SOC trend, multi-day navigation
- [x] Production deployment docs (root README + Worker setup)
- [x] Automated tests for adapters and API routes (Vitest + Miniflare)

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
│  • [planned] KV history keys — daily snapshots + rollups        │
│  • [planned] Cron Trigger — periodic snapshot of realtime data  │
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
5. **Store what we poll** — realtime snapshots become our own history; vendor APIs are a backfill source, not the sole archive.

### 2.2 Repository Layout

| Path | Role |
|------|------|
| `index.html` | Setup screen, dashboard cards, flow SVG, chart view, modals |
| `app.js` | API client, polling, rendering, system management, chart canvas |
| `style.css` | Dark theme, cards, flow diagram, chart view, modals, skeleton, PTR |
| `worker/src/index.js` | HTTP router, KV CRUD, adapter dispatch, history route |
| `worker/src/auth.js` | Bearer token check, CORS helpers |
| `worker/src/credentials.js` | AES-GCM credential encryption/decryption |
| `worker/src/services/shinemonitor.js` | ShineMonitor discover + fetchData + fetchHistory |
| `worker/src/services/growatt.js` | Growatt discover + fetchData + fetchHistory |
| `worker/wrangler.toml` | Worker name, KV binding, compatibility date |
| `discovery/` | ShineMonitor API reference + Python client |
| `discovery/growatt/` | Growatt API reference + Python client |
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

### 3.3 Stored history (planned)

Worker-owned snapshots extend the contract with durable storage independent of vendor retention:

```json
{
  "systemId": "uuid",
  "date": "2026-07-03",
  "source": "snapshot | vendor | merged",
  "intervalMinutes": 5,
  "points": [
    {
      "time": "14:30",
      "solar": 1200,
      "load": 850,
      "battery": -723,
      "soc": 72,
      "energyToday": 12.4
    }
  ],
  "dailySummary": {
    "solarKwh": 18.2,
    "loadKwh": 14.1,
    "peakSolarW": 3200,
    "minSoc": 45,
    "maxSoc": 98
  },
  "updatedAt": "2026-07-03T20:32:00Z"
}
```

**KV key layout (proposed):**

| Key | Value |
|-----|-------|
| `history:day:<systemId>:<YYYY-MM-DD>` | Daily snapshot JSON (points + summary) |
| `history:index:<systemId>` | JSON array of dates with stored data (newest first, capped) |
| `_history_meta` | Global retention config `{ retentionDays: 90 }` |

**Retention:** default 90 days per system; prune oldest keys on cron. ~15 KB/day × 90 days ≈ 1.4 MB/system — well within KV limits.

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
| `GET` | `/api/systems/:id/history?date=` | Intraday power series (vendor fetch today) |
| `GET` | `/api/systems/:id/history/summary?days=7` | **(planned)** Daily energy totals for bar chart |
| `GET` | `/api/systems/:id/history/range?from=&to=` | **(planned)** Multi-day stored series |

**Auth:** `Authorization: Bearer <API_TOKEN>`. If `API_TOKEN` secret is unset, worker runs open (dev only).

**Storage (KV):**

- `_index` — JSON array `[{ id, name, service }, ...]`
- `system:<uuid>` — full config including encrypted `credentials` object
- `history:day:<uuid>:<date>` — **(planned)** daily snapshot
- `history:index:<uuid>` — **(planned)** date index for fast listing

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

### 5.2 Planned — Historical Data & Graphs

- [ ] **Worker cron snapshots** — store normalized realtime every 5–15 min per system
- [ ] **Stored-history API** — serve KV data first; merge with or fallback to vendor `fetchHistory`
- [ ] **7-day energy bar chart** — daily solar kWh (and optionally load) below intraday chart
- [ ] **SOC trend line** — overlay or secondary chart for battery % over the day / 7 days
- [ ] **Multi-day navigation** — swipe or week strip to browse stored days without vendor round-trip
- [ ] **"Estimated" badge** — when chart data comes from snapshots vs vendor backfill
- [ ] **CSV export** — download day series from chart view
- [ ] **Chart empty states** — distinguish "no data yet" (cron not run) vs "date out of retention"

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
- [ ] **(planned)** `fetchHistorySummary` — aggregate last N days from stored KV or vendor day totals

### 6.2 Growatt (`growatt.js`)

- [x] Cookie-based login to `mqtt.growatt.com`
- [x] Discovery: plant list with multi-plant picker support
- [x] Session cache (4 min TTL)
- [x] Status code → human-readable label (STATUS_MAP)
- [x] Real-time + today's PV energy from totals endpoint
- [x] `fetchHistory` — `getStorageEnergyDayChart` + `getStorageLineChartData`
- [ ] Store only session token in KV, not plaintext password (re-login on expiry)
- [ ] **(planned)** `fetchHistorySummary` — `getStorageBatChart` for 7-day charge/discharge + SOC
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

### 7.2 Planned

- [ ] Worker deployment runbook (`wrangler secret put`, KV namespace setup, cron triggers)
- [ ] Adapter development guide for adding new inverter brands
- [ ] Historical data storage design doc (key schema, retention, merge strategy)

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
| History data in KV | N/A (not stored yet) | No credentials in history keys; same auth gate as other routes |

---

## 9. Infrastructure & Deployment

### 9.1 Current

- Worker: `solar-proxy` on Cloudflare (KV namespace bound in `wrangler.toml`)
- Default proxy URL baked into setup form: `https://solar-proxy.gaspar-solar.workers.dev`
- Frontend: static files; GitHub Actions CI runs worker tests; deploy on version tag
- PWA: `manifest.json` + `sw.js` for offline shell caching

### 9.2 Planned

- [x] GitHub Actions: lint worker, run adapter tests, deploy on tag
- [ ] Cloudflare Pages for frontend with auto-deploy from `main`
- [ ] Staging worker environment
- [x] Health check endpoint (`GET /api/health`)
- [ ] **Cron trigger** for history snapshots (`wrangler.toml` `[triggers]`)
- [ ] Structured logging / error reporting (e.g. Workers Analytics, Sentry)

---

## 10. Improvements & Ideas

### 10.1 High Impact

1. **Persistent historical storage + extended graphs** — cron snapshots to KV; 7-day energy bars; SOC trends; fills gaps when vendor history is missing or account is offline.
2. **Credential encryption in KV** — done via `CREDENTIALS_KEY`; ensure production always sets it.
3. **Multi-plant selection** — done at setup via `requiresPlantSelection` flow.
4. **Export data** — CSV download of day series for analysis.

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
15. **Generator runtime tracking** — accumulate hours when `grid.active` is true.
16. **E2E tests** — Playwright against mock worker for regression safety.
17. **Docker-compose local dev** — Miniflare + static file server for offline development.

---

## 11. Version History

| Version | Highlights |
|---------|------------|
| **v1.2.0** (planned) | Persistent history storage, 7-day energy chart, SOC trend |
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
- [x] Credential encryption at rest
- [x] GitHub Actions CI/CD

### Phase 3 — Data Depth (In Progress)

**3a — On-demand history (complete):**

- [x] Intraday power chart (both adapters)
- [x] `/api/systems/:id/history` endpoint
- [x] Display inverter status on dashboard
- [x] Multi-plant picker during system setup
- [x] Use ShineMonitor `BATTERY_SOC` when valid

**3b — Stored history & extended graphs (next):**

- [ ] Worker cron snapshot job (every 5–15 min)
- [ ] KV history storage module (write, read, merge, prune)
- [ ] History API: stored-first with vendor fallback
- [ ] `GET /api/systems/:id/history/summary?days=7`
- [ ] 7-day energy bar chart on dashboard
- [ ] SOC trend chart (intraday overlay + 7-day from Growatt `getStorageBatChart`)
- [ ] CSV export for chart data
- [ ] History storage unit tests

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
6. **Snapshot interval** — 5 min (matches vendor granularity) vs 15 min (lower KV writes, coarser chart)?
7. **History merge strategy** — When stored snapshots and vendor day series both exist, prefer vendor (richer) or stored (always available)?
8. **Retention default** — 90 days in KV sufficient, or offer configurable retention per deployment?

---

## 14. Known Risks

| Risk | Mitigation |
|------|------------|
| ShineMonitor/Growatt API changes without notice | Discovery scripts for quick validation; adapter version pinning in responses |
| Worker isolate cold start clears session cache | Re-auth is cheap; consider KV-backed session storage for high-traffic |
| KV credential leak if Worker compromised | Encrypt credentials; minimal secret surface; rotate API_TOKEN |
| Growatt session expiry mid-poll | 4-min cache TTL + retry with re-login on 401 |
| Voltage-based SOC inaccurate | Prefer API SOC; show "estimated" badge when interpolated |
| Vendor history gaps / account offline | **Store our own snapshots** — primary motivation for Phase 3b |
| KV write volume from cron | 288 writes/day/system at 5-min interval; batch into single daily key update instead |
| Cron failure during outage | Resume on next tick; backfill gaps via vendor `fetchHistory` when available |
| History keys grow unbounded | Retention job prunes keys older than N days; cap `history:index` length |
