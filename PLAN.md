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
- [ ] Historical charts (intraday power, 7-day energy)
- [ ] Production deployment docs and one-command setup
- [ ] Automated tests for adapters and API routes

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Static Frontend (index.html, app.js, style.css)              │
│  Hosted: GitHub Pages / Cloudflare Pages / any static host      │
│  Storage: localStorage (proxy URL, token, active system, view)  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS  Authorization: Bearer <token>
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Cloudflare Worker  (worker/)                                   │
│  • Token auth (API_TOKEN secret)                                │
│  • KV namespace SYSTEMS — system configs + credential index     │
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

### 2.2 Repository Layout

| Path | Role |
|------|------|
| `index.html` | Setup screen, dashboard cards, flow SVG, modals |
| `app.js` | API client, polling, rendering, system management |
| `style.css` | Dark theme, cards, flow diagram, modals, skeleton, PTR |
| `worker/src/index.js` | HTTP router, KV CRUD, adapter dispatch |
| `worker/src/auth.js` | Bearer token check, CORS helpers |
| `worker/src/services/shinemonitor.js` | ShineMonitor discover + fetchData |
| `worker/src/services/growatt.js` | Growatt discover + fetchData |
| `worker/wrangler.toml` | Worker name, KV binding, compatibility date |
| `discovery/` | ShineMonitor API reference + Python client |
| `discovery/growatt/` | Growatt API reference + Python client |
| `RELEASE_NOTES.md` | Version changelog |

---

## 3. Normalized Data Contract

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
- ShineMonitor SOC is **estimated from voltage** (42.0 V → 0%, 53.5 V → 100%) when plant-level `BATTERY_SOC` is unavailable.

---

## 4. Worker API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/services` | List supported service types and required fields |
| `GET` | `/api/systems` | List configured systems (id, name, service only) |
| `POST` | `/api/systems` | Add system: `{ service, name?, user, password }` → discover + store |
| `DELETE` | `/api/systems/:id` | Remove system from KV |
| `GET` | `/api/systems/:id/data` | Real-time normalized data for one system |
| `GET` | `/api/systems/all/data` | Parallel fetch for all systems |

**Auth:** `Authorization: Bearer <API_TOKEN>`. If `API_TOKEN` secret is unset, worker runs open (dev only).

**Storage (KV):**

- `_index` — JSON array `[{ id, name, service }, ...]`
- `system:<uuid>` — full config including `credentials` object

---

## 5. Frontend Features

### 5.1 Completed

- [x] **Setup screen** — proxy URL + access token; validates against `GET /api/systems`
- [x] **URL deep-link** — `?proxy=...&token=...` for home-screen bookmarks (params kept in URL)
- [x] **Dashboard cards** — battery SOC bar, solar %, load %, generator badge
- [x] **Flow diagram** — SVG with animated dashed paths; direction reverses for charge/discharge
- [x] **View toggle** — Cards / Flow; persisted in `localStorage`
- [x] **System tabs** — shown when 2+ systems; single system shows plant name in header
- [x] **Manage systems modal** — add (service picker), remove with confirm
- [x] **60 s polling** with connection status dot
- [x] **Pull-to-refresh** on mobile
- [x] **Skeleton shimmer** on first load and system switch
- [x] **Footer** — last update time, today's kWh when available

### 5.2 Planned / Not Started

- [ ] Historical intraday chart (5-min power series from ShineMonitor `queryDeviceDataOneDayPaging`)
- [ ] 7-day energy summary card
- [ ] Inverter status text displayed on dashboard (data already returned as `status`)
- [ ] Configurable poll interval
- [ ] Desktop keyboard shortcut for refresh
- [ ] Error toast / retry UI when poll fails
- [ ] PWA manifest + service worker for installable home-screen app
- [ ] Light theme / high-contrast mode

---

## 6. Service Adapters

### 6.1 ShineMonitor (`shinemonitor.js`)

- [x] SHA-1 auth flow with `company-key`
- [x] Discovery: first plant, first collector device
- [x] Session cache (5 min TTL, per isolate)
- [x] Plant timezone for `date` query parameter
- [x] Fallback to yesterday when today's device data missing
- [x] Field mapping: Charger Power, PV Voltage, PLoad, PGrid, Grid Voltage, Batt Current, Battery Voltage
- [ ] Use plant-level `BATTERY_SOC` when not `-1` instead of voltage estimate
- [ ] Multi-plant picker at setup (currently auto-selects first plant)
- [ ] Multi-device support (systems with multiple inverters)
- [ ] Handle token/secret expiry with automatic re-auth

### 6.2 Growatt (`growatt.js`)

- [x] Cookie-based login to `mqtt.growatt.com`
- [x] Discovery: first plant, first storage device
- [x] Session cache (4 min TTL)
- [x] Status code → human-readable label (STATUS_MAP)
- [x] Real-time + today's PV energy from totals endpoint
- [ ] Store only session token in KV, not plaintext password (re-login on expiry)
- [ ] Multi-plant picker
- [ ] Chart endpoints: `getStorageLineChartData`, 7-day battery history
- [ ] Weather data integration (available via Growatt API)

---

## 7. Discovery & Documentation

### 7.1 Completed

- [x] ShineMonitor `API.md` — full endpoint reference with signing algorithm
- [x] ShineMonitor `fetch_plant_json.py` — login + sample queries
- [x] Growatt `API.md` + `fetch_data.py` + README
- [x] Documented CORS limitation motivating the proxy architecture

### 7.2 Planned

- [ ] Root `README.md` — architecture overview, deploy guide, screenshots
- [ ] Worker deployment runbook (`wrangler secret put`, KV namespace setup)
- [ ] Adapter development guide for adding new inverter brands
- [ ] Sanitize Growatt README — remove hardcoded credentials from examples

---

## 8. Security

| Area | Current State | Target |
|------|---------------|--------|
| Proxy access | Bearer token (optional in dev) | Always required in production |
| Credential storage | Plaintext in KV (Growatt password, ShineMonitor pwdSha1) | Encrypt at rest or use Worker Secrets per system |
| CORS | `Access-Control-Allow-Origin: *` or request origin | Restrict to known frontend origins |
| Rate limiting | None | Per-token rate limits on `/api/systems/*/data` |
| Discovery scripts | Env-var credentials | Already good; audit for committed secrets |
| Growatt README | Contains real credentials in curl examples | Redact immediately |

---

## 9. Infrastructure & Deployment

### 9.1 Current

- Worker: `solar-proxy` on Cloudflare (KV namespace bound in `wrangler.toml`)
- Default proxy URL baked into setup form: `https://solar-proxy.gaspar-solar.workers.dev`
- Frontend: static files, no CI/CD

### 9.2 Planned

- [ ] GitHub Actions: lint worker, run adapter tests, deploy on tag
- [ ] Cloudflare Pages for frontend with auto-deploy from `main`
- [ ] Staging worker environment
- [ ] Health check endpoint (`GET /api/health`)
- [ ] Structured logging / error reporting (e.g. Workers Analytics, Sentry)

---

## 10. Improvements & Ideas

### 10.1 High Impact

1. **Historical charts** — ShineMonitor already exposes 5-minute day series; Growatt has `getStorageLineChartData`. A simple canvas/SVG chart below the cards would add major value.
2. **Root README + deploy guide** — lowers barrier for self-hosting; document token generation and KV setup.
3. **Credential encryption in KV** — use Web Crypto AES-GCM with a master key stored as Worker secret.
4. **Multi-plant selection** — discovery returns first plant only; many users have multiple sites on one account.
5. **Redact secrets in `discovery/growatt/README.md`** — real username/password in curl examples is a security risk.

### 10.2 Medium Impact

6. **PWA** — `manifest.json`, icons, service worker caching static shell; enables true home-screen install without URL params.
7. **Alerts / notifications** — webhook or email when SOC drops below threshold or generator starts (Worker cron trigger).
8. **Comparison view** — side-by-side cards when multiple systems selected (uses existing `/api/systems/all/data`).
9. **Inverter status badge** — surface `status` field (e.g. "PV Charging", "Battery Discharging") on cards view.
10. **Configurable thresholds** — user-defined low-battery warning level, generator detection sensitivity.
11. **Export data** — CSV download of day series for analysis.
12. **i18n** — Spanish labels (many Growatt/ShineMonitor users in LATAM).

### 10.3 Nice to Have

13. **Additional adapters** — Victron VRM, Solis, Deye, SMA (each needs discovery pass like existing folders).
14. **Home Assistant integration** — expose normalized data via MQTT or REST for HA dashboards.
15. **Dark/light theme toggle** with system preference detection.
16. **WebSocket push** — replace polling when inverter APIs support it (ShineMonitor has `ws.shinemonitor.com`).
17. **Battery time-to-empty estimate** — based on current load and SOC.
18. **Generator runtime tracking** — accumulate hours when `grid.active` is true.
19. **E2E tests** — Playwright against mock worker for regression safety.
20. **Docker-compose local dev** — Miniflare + static file server for offline development.

---

## 11. Version History

| Version | Highlights |
|---------|------------|
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

### Phase 2 — Documentation & Hardening (Next)

- [ ] Root README with architecture and deploy instructions
- [ ] Redact credentials from discovery docs
- [ ] Always-on API_TOKEN in production
- [ ] CORS origin allowlist
- [ ] Health check endpoint
- [ ] Basic worker unit tests (Vitest + Miniflare)

### Phase 3 — Data Depth

- [ ] Intraday power chart (both adapters)
- [ ] 7-day energy history
- [ ] Display inverter status on dashboard
- [ ] Multi-plant picker during system setup
- [ ] `/api/systems/:id/history` endpoint

### Phase 4 — Productization

- [ ] PWA support
- [ ] CI/CD pipeline
- [ ] SOC threshold alerts (Worker cron + webhook)
- [ ] Credential encryption at rest
- [ ] Staging environment

### Phase 5 — Expansion

- [ ] Third-party adapter framework documented
- [ ] Victron or Solis adapter (TBD by user need)
- [ ] Home Assistant bridge
- [ ] i18n (ES)

---

## 13. Open Questions

1. **Hosting split** — Should frontend and worker share a Cloudflare account/project, or remain independently deployable?
2. **SOC source of truth** — For ShineMonitor, prefer API `BATTERY_SOC` when valid, or always use voltage interpolation?
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
| No automated tests | Phase 2 adds Vitest coverage for signing, normalization, routes |
