# Adapter Development Guide

This guide explains how to add a new inverter brand to the Solar Dashboard. It covers the full lifecycle: reverse-engineering a vendor API, documenting it, implementing a Worker adapter, registering routes, and writing fixture-based tests that run in CI.

**Reference implementations:** [ShineMonitor](../worker/src/services/shinemonitor.js) and [Growatt](../worker/src/services/growatt.js).

**Related docs:** [PLAN.md §3](../PLAN.md) (normalized data contract), [PLAN.md §6](../PLAN.md) (adapter status), [README.md](../README.md) (architecture and deploy).

---

## 1. Why a Worker adapter?

The static frontend cannot call most inverter cloud APIs directly:

| Constraint | ShineMonitor | Growatt |
|------------|--------------|---------|
| **CORS** | Browser calls may work for some endpoints, but credentials must not live in JS | No `Access-Control-Allow-Origin` — blocked in browser |
| **Auth** | SHA-1 signed GET with session `token`/`secret` | Cookie-based `JSESSIONID` from POST login |
| **Secrets** | Username + password (hashed) | Username + password |

The Cloudflare Worker acts as a **server-side proxy**: it holds credentials in KV (AES-GCM encrypted when `CREDENTIALS_KEY` is set), authenticates to the vendor, and returns **one normalized JSON shape** regardless of brand.

Design principles (from [PLAN.md](../PLAN.md)):

1. **Normalize at the adapter boundary** — the frontend only understands the contract in §3 below.
2. **Discover once, poll many** — plant ID, device SN, nominal power, timezone, etc. are captured at setup and stored in KV.
3. **Vendor is source of truth for history** — charts fetch from vendor APIs on demand; the Worker does not archive readings in KV.
4. **Fail gracefully** — throw descriptive errors for 502 responses; return empty series rather than crashing when a day has no data.

---

## 2. Discovery folder layout

Each brand gets a folder under `discovery/` with API notes and a runnable script for manual validation:

```
discovery/
├── ADAPTER_GUIDE.md          ← this file
├── README.md                 ← ShineMonitor discovery index
├── API.md                    ← ShineMonitor endpoint reference + examples
├── fetch_plant_json.py       ← ShineMonitor Python client
└── growatt/
    ├── README.md             ← Growatt quick start + CORS note
    ├── API.md                ← Growatt endpoint reference
    └── fetch_data.py         ← Growatt Python client
```

When adding a brand (e.g. Victron):

```
discovery/victron/
├── README.md       # Quick start, env vars, security notes
├── API.md          # Full endpoint reference with example JSON
└── fetch_data.py   # Minimal login + sample queries (stdlib or requests)
```

### 2.1 What to document in discovery

| Section | Purpose |
|---------|---------|
| **Base URL(s)** | Host, path prefix, HTTP method |
| **Authentication** | Login flow, session lifetime, signing algorithm |
| **Discovery endpoints** | Plant list, device list, nominal power |
| **Realtime endpoints** | Fields for battery, solar, load, grid |
| **History endpoints** | Intraday series, daily totals, SOC |
| **Example responses** | Copy-pasteable JSON (redact credentials) |
| **CORS / browser access** | Whether a proxy is required |
| **Quirks** | Timezones, pagination, `-1` sentinel values, session expiry |

Use environment variables for credentials in scripts — never commit real passwords.

### 2.2 Reverse-engineering workflow

1. **Capture traffic** — Browser DevTools → Network while using the vendor portal; or use mitmproxy.
2. **Identify auth** — Login request, cookies, headers, signing params.
3. **Map endpoints** — Plant list → device list → realtime → day chart.
4. **Write `fetch_*.py`** — Reproduce auth + one realtime + one history call.
5. **Record fixtures** — Save sanitized JSON under `worker/test/fixtures/<brand>/` for parser tests.
6. **Implement adapter** — Port the Python logic to `worker/src/services/<brand>.js`.
7. **Test without hardware** — Vitest mocks `globalThis.fetch` using fixtures.

---

## 3. Adapter interface

Every service module in `worker/src/services/` exports a consistent surface. The router in `worker/src/index.js` dispatches to these functions.

### 3.1 Required exports

| Function | When called | Purpose |
|----------|-------------|---------|
| `discover(credentials, plantId?)` | `POST /api/systems` | Authenticate, list plants/devices, return IDs for KV storage |
| `fetchData(systemConfig)` | `GET /api/systems/:id/data`, alerts cron | Return normalized realtime snapshot |

### 3.2 Optional exports

| Function | When called | Purpose |
|----------|-------------|---------|
| `fetchHistory(systemConfig, date?)` | `GET /api/systems/:id/history?date=` | Intraday power series for one day |
| `fetchHistorySummary(systemConfig, days?, endDate?)` | `GET /api/systems/:id/history/summary` | Multi-day bar chart + SOC trend |

If `fetchHistory` or `fetchHistorySummary` is missing, the route returns **501 Not Implemented**.

### 3.3 `discover(credentials, plantId)`

**Input:**

```js
credentials = { user: string, password: string }
plantId     = string | null   // from POST body when user picks a plant
```

**Output — single plant (ready to store):**

```js
{
  plantId: "12345",
  plantName: "My Cabin",
  nominalPower: 5000,        // watts — used for load % and solar bar
  // brand-specific fields → stored via buildCredentials()
}
```

**Output — multi-plant selection:**

When the account has multiple plants and `plantId` is not provided, return:

```js
{
  requiresPlantSelection: true,
  plants: [{ id: "123", name: "Home" }, { id: "456", name: "Cabin" }],
  // include any session material needed for the follow-up POST (e.g. pwdSha1)
}
```

The frontend re-posts the same `user`, `password`, and selected `plantId` in a second `POST /api/systems`. The router only forwards `{ requiresPlantSelection, plants }` to the client — session material stays inside the adapter.

**ShineMonitor `pwdSha1` pattern:** `discover()` hashes the password once and stores `pwdSha1` in KV via `buildCredentials()` so later polls never need the plaintext password. Growatt stores the plaintext password because its login API requires it on each session refresh.

**Errors:** Throw `Error` with a human-readable message. The router wraps failures as `502 Discovery failed: …`.

### 3.4 `fetchData(systemConfig)`

**Input:** Full system config from KV (decrypted credentials):

```js
{
  id: "uuid",
  name: "My Home Solar",
  service: "shinemonitor",
  credentials: { /* brand-specific — see §5 */ },
}
```

**Output:** Normalized realtime object (§4.1). Must include `systemId`, `name`, and `service`.

**Errors:** Throw on auth failure or unrecoverable API errors → router returns `502 Fetch failed: …`.

### 3.5 `fetchHistory(systemConfig, date)`

**Input:** `date` is `YYYY-MM-DD` or `null` (adapter picks “today” in plant-local time).

**Output:** Normalized intraday history (§4.2).

**Patterns from reference adapters:**

- **ShineMonitor** — Paginated `queryDeviceDataOneDayPaging`; falls back to yesterday when today is empty; parses rows with `parseHistoryRows()`.
- **Growatt** — Parallel `getStorageEnergyDayChart` + `getStorageLineChartData`; optional SOC overlay from `getStorageBatChart`.

### 3.6 `fetchHistorySummary(systemConfig, days, endDate)`

**Input:** `days` is 1–90 (validated by router); `endDate` is `YYYY-MM-DD` or `null` (defaults to today).

**Output:** Multi-day summary (§4.3).

Both current adapters aggregate by calling `fetchHistory()` per day and running `computeDailySummary()` from `worker/src/history.js`. Growatt optionally enriches SOC via `fetchSocDailySummary()`. Prefer a dedicated vendor endpoint when one exists (fewer round-trips).

---

## 4. Normalized JSON contract

The frontend (`app.js`) and tests (`worker/test/helpers.js`) expect these shapes. **Do not change field names** without updating the frontend and `expectNormalizedShape()`.

### 4.1 Realtime — `fetchData`

```json
{
  "systemId": "uuid",
  "name": "My Home Solar",
  "service": "shinemonitor",
  "timestamp": "2026-07-03 14:32:00",
  "battery": {
    "voltage": 48.2,
    "soc": 72,
    "socSource": "api",
    "current": -15,
    "power": -723
  },
  "solar": { "power": 1200, "voltage": 95 },
  "load": { "power": 850, "percent": 24 },
  "grid": { "power": 0, "voltage": 0, "active": false },
  "inverter": { "ratedPower": 3500, "nominalPV": 5000 },
  "status": "PV Charging",
  "energyToday": 12.4
}
```

**Sign conventions:**

| Field | Rule |
|-------|------|
| `battery.current` | Negative = charging, positive = discharging |
| `battery.power` | `voltage × current` (rounded) |
| `battery.socSource` | `"api"` when SOC comes from vendor; `"estimated"` when derived (ShineMonitor voltage interpolation) |
| `grid.active` | `true` when grid/generator input detected — typically `gridV > 30 && \|gridW\| > 5` |
| `load.percent` | `(loadW / ratedPower) × 100`, capped reasonably |
| `energyToday` | kWh produced today, or `null` if unavailable |

### 4.2 Intraday history — `fetchHistory`

```json
{
  "systemId": "uuid",
  "name": "My Home Solar",
  "service": "shinemonitor",
  "date": "2026-07-03",
  "timezoneOffset": -21600,
  "intervalMinutes": 5,
  "points": [
    { "time": "06:00", "solar": 0, "load": 120, "battery": -45, "soc": 72 }
  ]
}
```

| Field | Rule |
|-------|------|
| `time` | `HH:MM` local to the plant |
| `solar`, `load`, `battery` | Watts; battery power uses same sign as realtime |
| `soc` | Optional per-point SOC (0–100) when vendor provides it |
| `intervalMinutes` | Usually `5`; used by `computeDailySummary()` |

Points should be **chronological** (oldest first).

### 4.3 Multi-day summary — `fetchHistorySummary`

```json
{
  "systemId": "uuid",
  "days": 7,
  "endDate": "2026-07-03",
  "series": [
    {
      "date": "2026-07-03",
      "solarKwh": 18.2,
      "loadKwh": 14.1,
      "peakSolarW": 3200,
      "minSoc": 45,
      "maxSoc": 98,
      "source": "vendor"
    }
  ]
}
```

Use `null` for missing metrics on a day (vendor gap). Set `source: "vendor"` when data comes from the inverter cloud.

---

## 5. Credential storage

After discovery, `buildCredentials()` in `worker/src/index.js` maps the discovery result into the KV `credentials` object. Extend this function for your brand:

```js
function buildCredentials(service, password, discovered) {
  if (service === "shinemonitor") {
    return {
      pwdSha1: discovered.pwdSha1,
      plantId: discovered.plantId,
      device: discovered.device,
      nominalPower: discovered.nominalPower,
      timezone: discovered.timezone,
    };
  }
  if (service === "growatt") {
    return {
      password,
      plantId: discovered.plantId,
      storageSn: discovered.storageSn,
      nominalPower: discovered.nominalPower,
      nominalPV: discovered.nominalPV,
    };
  }
  // New brand:
  if (service === "victron") {
    return { /* tokens, site ID, etc. */ };
  }
  return { password };
}
```

**Guidelines:**

- Store **stable identifiers** (plant ID, device SN, site ID) — not ephemeral session tokens, when possible.
- Prefer **derived secrets** (e.g. ShineMonitor `pwdSha1`) over plaintext password when the auth flow allows it.
- Include **timezone offset in seconds** when the vendor uses plant-local dates.
- Credentials are encrypted at rest when `CREDENTIALS_KEY` is set ([credentials.js](../worker/src/credentials.js)).

---

## 6. Registering a new adapter

### 6.1 Create the service module

```
worker/src/services/victron.js
```

Export `discover`, `fetchData`, and optionally `fetchHistory` / `fetchHistorySummary`.

### 6.2 Register in the router

In `worker/src/index.js`:

```js
import * as victron from "./services/victron.js";

const ADAPTERS = { shinemonitor, growatt, victron };
```

### 6.3 Expose in `/api/services`

Add an entry so the setup UI shows the new service:

```js
return jsonResponse([
  { id: "shinemonitor", name: "ShineMonitor", fields: ["user", "password"] },
  { id: "growatt", name: "Growatt", fields: ["user", "password"] },
  { id: "victron", name: "Victron VRM", fields: ["user", "password"] },
], 200, origin);
```

Adjust `fields` if the brand needs an API token, site ID, etc. (frontend modal may need a small update for extra fields).

### 6.4 Alerts cron (optional)

`scheduled()` passes `ADAPTERS` to `runScheduledAlerts()`. If your adapter implements `fetchData()`, it automatically participates in SOC/generator alert evaluation.

---

## 7. Session management

Vendor sessions should be cached **in memory per Worker isolate**, not in KV.

```js
const sessionCache = new Map();
const SESSION_TTL = 300_000; // tune per vendor

async function getSession(systemConfig) {
  const key = systemConfig.id;
  const cached = sessionCache.get(key);
  if (cached && Date.now() - cached.ts < SESSION_TTL) return cached;

  const sess = await login(/* ... */);
  sessionCache.set(key, { ...sess, ts: Date.now() });
  return sess;
}
```

| Adapter | TTL | Notes |
|---------|-----|-------|
| ShineMonitor | 5 min | Re-auth via `action=auth` |
| Growatt | 4 min | Cookie expires quickly; re-login on parse failure |

On 401 or “session expired” responses, clear the cache entry and retry once.

---

## 8. Shared helpers

`worker/src/history.js` provides pure functions adapters can import:

| Export | Use |
|--------|-----|
| `computeDailySummary(points)` | Integrate 5-min watts → daily kWh + SOC min/max |
| `dateRange(endDate, days)` | Inclusive date list for summary loops |
| `mergeSocIntoPoints(points, socByTime)` | Overlay SOC onto power points |
| `socMapFromPoints(points)` | Build time → SOC map |
| `supplementSummarySoc(series, socByDate)` | Fill min/max SOC on summary days |
| `computeSocExtrema(values)` | Min/max from raw SOC array |

Export **pure parsers** (e.g. `parseHistoryRows`, `parseEnergyDayPoints`) from your adapter module so they can be unit-tested against fixtures without mocking `fetch`.

---

## 9. CORS and auth constraints

### 9.1 Worker auth (`auth.js`)

- Clients send `Authorization: Bearer <API_TOKEN>`.
- When `API_TOKEN` is unset (local dev), all authenticated routes are open.
- **Production:** always set `API_TOKEN` via `wrangler secret put API_TOKEN`.

### 9.2 CORS

- `ALLOWED_ORIGINS` — comma-separated list of frontend origins.
- Unset = reflect request origin (dev).
- Browser requests from unlisted origins receive **403** before auth is checked.
- `OPTIONS` preflight returns 204 with CORS headers when allowed.

### 9.3 Rate limiting (`rateLimit.js`)

Data routes (`GET /api/systems/:id/data` and `GET /api/systems/all/data`) are capped at **60 requests per minute per bearer token** (in-memory per Worker isolate).

- When `API_TOKEN` is unset (dev open mode), rate limiting is disabled.
- Exceeded limits return **429** with `{ error: "Rate limit exceeded" }` and a `Retry-After` header (seconds).
- New adapters do not need rate-limit hooks — only realtime poll routes are throttled. History routes are unthrottled today; keep vendor round-trips efficient in `fetchHistorySummary` loops.

### 9.4 Route error mapping

| Situation | Status | Body |
|-----------|--------|------|
| Origin not in `ALLOWED_ORIGINS` | 403 | empty |
| Missing/invalid bearer token | 401 | `{ error: "Unauthorized" }` |
| Bad request (missing fields, invalid date) | 400 | `{ error: "…" }` |
| System not found | 404 | `{ error: "System not found" }` |
| Rate limit exceeded | 429 | `{ error: "Rate limit exceeded" }` |
| Adapter missing optional method | 501 | `{ error: "History not supported…" }` |
| Vendor/discovery failure | 502 | `{ error: "Fetch failed: …" }` |

---

## 10. Testing

### 10.0 CI pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs three jobs on every push and pull request:

| Job | Command | What it validates |
|-----|---------|-------------------|
| `worker-test` | `cd worker && npm test` | Adapter parsers, mocked fetch, route dispatch (Vitest + `@cloudflare/vitest-pool-workers`) |
| `frontend-test` | `cd frontend && npm test` | Pure helpers in `frontend/lib.js` (formatting, CSV, escaping) |
| `e2e` | `cd e2e && npm run test:ci` | Playwright flows against mock Worker + static frontend |

All three must pass before a semver release tag triggers production deploy.

### 10.1 Worker unit tests

Tests run with **Vitest** and `@cloudflare/vitest-pool-workers` in `worker/`:

```bash
cd worker && npm test
```

### 10.2 Test file layout

```
worker/test/
├── helpers.js              # expectNormalizedShape, expectHistorySummaryShape, createMockKV
├── victron.test.js         # your adapter tests
├── fixtures/
│   └── victron/
│       ├── auth-success.json
│       ├── realtime.json
│       └── day-chart-2026-07-03.json
└── fixtures.test.js        # parser regression tests (optional shared file)
```

### 10.3 What to test

| Layer | Example | File pattern |
|-------|---------|--------------|
| **Pure helpers** | Signing, SOC resolution, row parsing | `describe("parseFooRows")` with fixture JSON |
| **fetchData** | Mock `globalThis.fetch`, assert normalized shape | `shinemonitor.test.js` |
| **fetchHistory** | Return fixture per URL/date | `growatt.test.js` |
| **fetchHistorySummary** | Multi-day fixture map | `historySummary.test.js` |
| **Routes** | `createMockKV`, hit `fetch` handler | `routes.test.js` |

### 10.4 Mocking fetch

```js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchData } from "../src/services/victron.js";
import { expectNormalizedShape } from "./helpers.js";
import authFixture from "./fixtures/victron/auth-success.json";

describe("victron fetchData", () => {
  let originalFetch;

  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns normalized output from mocked API", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes("/login")) return Response.json(authFixture);
      if (String(url).includes("/status")) return Response.json({ /* … */ });
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const data = await fetchData({
      id: "test-1",
      name: "Test Site",
      credentials: { /* … */ },
    });

    expectNormalizedShape(data);
    expect(data.service).toBe("victron");
  });
});
```

When adding a brand, update `expectNormalizedShape()` in `helpers.js` to accept the new `service` id:

```js
service: expect.stringMatching(/^(shinemonitor|growatt|victron)$/),
```

### 10.5 Recording fixtures

1. Run your discovery script against a test account.
2. Copy response JSON into `worker/test/fixtures/<brand>/`.
3. **Redact** tokens, cookies, usernames, plant names if checking into git.
4. Trim large arrays to 3–5 representative samples (keep edge cases: empty day, `-1` SOC, missing fields).

### 10.6 Route-level tests

`routes.test.js` uses `createMockKV()` and the Worker's default export to verify:

- Auth gate (401 without bearer)
- `POST /api/systems` discovery + KV write
- `GET /api/systems/:id/history` dispatches to adapter
- Invalid date → 400

Add cases for your service id when registration changes behavior.

### 10.7 E2E with mock Worker

Playwright specs in `e2e/tests/` exercise the static frontend against `e2e/fixtures/mock-worker.js` — a lightweight HTTP server that returns canned normalized JSON (no real inverter credentials).

```bash
cd e2e && npm ci && npx playwright install chromium && npm test
```

When adding a brand that changes setup or chart behavior:

1. Add mock payloads in `e2e/fixtures/payloads.js`.
2. Extend `mock-worker.js` routes if new API paths are needed.
3. Add or extend specs in `e2e/tests/` (setup, dashboard cards, chart view).

See [e2e/README.md](../e2e/README.md) for manual server mode and environment variables.

---

## 11. End-to-end checklist

Use this when adding a brand from scratch:

### Discovery

- [ ] Create `discovery/<brand>/README.md`, `API.md`, `fetch_data.py`
- [ ] Document auth, realtime, history endpoints with example JSON
- [ ] Note CORS behavior and session lifetime
- [ ] Verify script runs with env-var credentials

### Adapter

- [ ] Create `worker/src/services/<brand>.js`
- [ ] Implement `discover()` with multi-plant support if applicable
- [ ] Implement `fetchData()` matching §4.1
- [ ] Implement `fetchHistory()` matching §4.2 (if vendor supports it)
- [ ] Implement `fetchHistorySummary()` matching §4.3 (or defer → 501)
- [ ] In-memory session cache with appropriate TTL
- [ ] Export pure parsers for fixture tests

### Registration

- [ ] Add to `ADAPTERS` in `worker/src/index.js`
- [ ] Extend `buildCredentials()` for KV shape
- [ ] Add entry to `GET /api/services`
- [ ] Update frontend setup modal if extra credential fields are needed

### Tests

- [ ] Add fixtures under `worker/test/fixtures/<brand>/`
- [ ] Add `worker/test/<brand>.test.js` (parsers + mocked fetchData/fetchHistory)
- [ ] Extend `historySummary.test.js` if summary is implemented
- [ ] Update `helpers.js` service regex
- [ ] `cd worker && npm test` passes locally
- [ ] (optional) Extend `e2e/fixtures/payloads.js` and mock Worker if UI flows change

### Documentation

- [ ] Link discovery folder from root `README.md` (Related docs table)
- [ ] Add adapter notes to [PLAN.md §6](../PLAN.md) when stable

---

## 12. Reference comparison

| Topic | ShineMonitor | Growatt |
|-------|--------------|---------|
| **Module** | `worker/src/services/shinemonitor.js` | `worker/src/services/growatt.js` |
| **Discovery** | `discovery/API.md`, `fetch_plant_json.py` | `discovery/growatt/API.md`, `fetch_data.py` |
| **Auth** | SHA-1 signed GET | POST login + `JSESSIONID` cookie |
| **Session TTL** | 5 minutes | 4 minutes |
| **Stored credentials** | `user`, `pwdSha1`, `plantId`, `device{…}`, `timezone` | `user`, `password`, `plantId`, `storageSn`, `nominalPower`, `nominalPV` |
| **Realtime** | Latest device row + plant-level metrics | `getStorageStatusData` + `getStorageTotalData` |
| **History** | Paginated device day data | Energy day chart + line chart + optional bat chart |
| **Summary** | N × `fetchHistory` + `computeDailySummary` | Same + `fetchSocDailySummary` enrichment |
| **Timezone** | Plant offset from `queryPlantInfo` | UTC dates (offset `0`) |
| **Empty today** | Fallback to yesterday | No fallback (returns empty points) |
| **Tests** | `shinemonitor.test.js`, `fixtures.test.js` | `growatt.test.js`, `historySummary.test.js` |

---

## 13. Frontend impact

The dashboard is **service-agnostic** — it only consumes normalized JSON. Adding an adapter usually requires **no frontend changes** unless:

- The setup form needs new credential fields (update `index.html` / `app.js` manage-systems flow).
- The brand uses different semantics for `grid.active` (e.g. grid-tied vs generator) — consider a per-system label later.

History chart, CSV export, and 7-day bar chart work automatically once `fetchHistory` and `fetchHistorySummary` return the contract in §4.

---

## 14. Local development

```bash
# Terminal 1 — Worker (open auth if API_TOKEN unset)
cd worker && npm run dev

# Terminal 2 — static frontend
python3 -m http.server 8080
# Open http://localhost:8080 — point setup at http://localhost:8787
```

Use `wrangler secret put API_TOKEN` and `CREDENTIALS_KEY` to mirror production behavior.

---

_For questions or adapter proposals, see [PLAN.md §10.3](../PLAN.md) (additional adapters) and open a PR with discovery docs + adapter + tests._
