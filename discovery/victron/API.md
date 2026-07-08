# Victron VRM API Reference

> Compiled from public Victron documentation and community sources — **not yet validated
> against a live VRM account** (no test system was available during this spike). Endpoint
> shapes below are believed accurate as of 2026-07 but should be confirmed with a real
> `fetch_data.py` run before an adapter is implemented. See [README.md](README.md) for
> sources and verification status.

## Base URL

```
https://vrmapi.victronenergy.com/v2
```

Unlike ShineMonitor and Growatt, VRM is Victron's own multi-tenant cloud (not a
white-labeled inverter portal), and its API is intended for third-party integration —
there is an official docs site at `https://vrm-api-docs.victronenergy.com/` (Swagger/OpenAPI)
and a first-party Python client (`victronenergy/vrm-api-python-client`).

---

## Authentication

VRM supports two auth modes:

### 1. Username/password login

```
POST /v2/auth/login
Content-Type: application/json
```

```json
{ "username": "YOUR_EMAIL", "password": "YOUR_PASSWORD" }
```

**Response:**

```json
{ "token": "abc123...", "idUser": 123456, "verification_mode": "password", "verification_sent": false }
```

If the account has 2FA enabled, `verification_mode` indicates the second factor and a
follow-up call to `/v2/auth/logintotp` (or similar) is required — **this is a discovery
gap**: 2FA-enabled accounts cannot complete a fully automated `discover()` flow the way
ShineMonitor/Growatt do today.

### 2. Personal Access Token (PAT) — recommended

Created manually in the VRM Portal UI: **Preferences → Integrations → Access Tokens**
(`https://vrm.victronenergy.com/access-tokens`). A PAT does not require 2FA handling and
does not expire on inactivity, making it a better fit for a server-side adapter than
username/password.

**Auth header (both modes), used on every subsequent request:**

```
X-Authorization: Bearer <token>       # from /v2/auth/login
X-Authorization: Token <token>        # personal access token
```

(Community reports disagree slightly on `Bearer` vs `Token` prefix for PATs — confirm
empirically before hardcoding.)

---

## CORS

**Confirmed no browser access.** VRM API responses do not include usable
`Access-Control-Allow-Origin` headers for arbitrary origins; multiple community threads
describe the API working fine server-side but failing from browser JS, with users
resorting to CORS proxies as a workaround. This matches the Growatt situation — **a
server-side proxy (the existing Cloudflare Worker) is required**, which fits the current
architecture without changes.

---

## Discovery

### List installations for the logged-in user

```
GET /v2/users/{idUser}/installations?extended=1
```

Returns each site the account can see: `idSite`, `name`, `identifier` (gateway serial),
timezone, and (with `extended=1`) current values like PV power and battery state at time
of listing. This is the multi-site equivalent of ShineMonitor's plant list / Growatt's
`getPlantListTitle` — maps cleanly onto the existing `requiresPlantSelection` flow in
`ADAPTER_GUIDE.md` §3.3.

### List devices within a site

Device/instance list is derived from the **diagnostics** endpoint (below) rather than a
dedicated "device list" call — each diagnostics record carries a device `instance` number
and a human-readable device name. There does not appear to be a single-device-per-site
assumption in VRM the way there is for ShineMonitor/Growatt (see "Multi-device" note under
Feasibility).

---

## Realtime data

Two candidate endpoints; either could back `fetchData()`:

### Diagnostics (most complete)

```
GET /v2/installations/{idSite}/diagnostics?count=1
```

Returns the latest values for every monitored attribute across every device on the site:

```json
{
  "success": true,
  "records": [
    {
      "instance": 0,
      "dbusServiceType": "vebus",
      "dbusPath": "/Soc",
      "code": "SOC",
      "description": "State of charge",
      "formattedValue": "87 %",
      "rawValue": 87,
      "timestamp": 1751980800
    }
  ]
}
```

Known/likely attribute `code`s relevant to the normalized contract (community-sourced —
**needs confirmation against a real diagnostics dump**):

| Code | Likely meaning | Normalized field |
|------|-----------------|-------------------|
| `SOC` | Battery state of charge (%) | `battery.soc` |
| (voltage code TBD) | Battery voltage (V) | `battery.voltage` |
| (current code TBD) | Battery current (A) | `battery.current` |
| `PVP` (unconfirmed) | PV power (W) | `solar.power` |
| `Pc` / `Bc` / `Pb` etc. | Power flow between PV/battery/consumers/grid | `solar.power`, `load.power`, `grid.power` |
| `AcOut` (unconfirmed) | AC output / load power (W) | `load.power` |
| `TTG` | Time to go (battery empty estimate) | maps to PLAN §10.3 idea #14 (time-to-empty), not current contract |

Victron's own docs note: **match on `code`, not on the numeric `dataAttributeId`** — IDs
are not guaranteed stable across installations.

### Widgets (targeted, per-device-type)

```
GET /v2/installations/{idSite}/widgets/{WidgetType}
```

`WidgetType` examples observed: `BatterySummary`, `Status`, `VeBusState`, `MPPTState`,
`SolarChargerSummary`, `PVInverterStatus`, `Overview`, `GPS`, `Alarm`, `HistoricData`.
Supports `attributeCodes[]`, `instance`, `start`, `end` query params to scope the request.
Better suited to fetching one specific device's data than a whole-site snapshot; `diagnostics`
is likely the simpler basis for `fetchData()` since it returns everything in one call.

---

## Historical data

### Stats (intraday + multi-day)

```
GET /v2/installations/{idSite}/stats?type=kwh&start={epoch}&end={epoch}&interval=15mins
```

`interval` accepts values like `15mins`, `hours`, `days` (exact enum unconfirmed). This is
promising for both history contracts in `PLAN.md` §3:

- `interval=15mins` (or similar) over a single day → `fetchHistory()` (§4.2)
- `interval=days` over N days → `fetchHistorySummary()` (§4.3)

### Overall stats

```
GET /v2/installations/{idSite}/overallstats?type=kwh
```

Lifetime/summary totals — useful for `energyToday` cross-checks but not day-series data.

---

## Rate limits

No published numeric limit found. Community reports describe intermittent rate-limiting
sitting in front of the API (observed even at ~2 req/s in one report), and the API is
Cloudflare-fronted. **Assume a conservative rate limit** and reuse the existing in-memory
session-cache pattern (`ADAPTER_GUIDE.md` §7) to avoid hitting it — this matters more for
Victron than Growatt/ShineMonitor if `fetchHistorySummary` ends up making one `stats` call
per day rather than a single ranged call (VRM's `start`/`end` range support may avoid this
entirely — another point to confirm before implementing).

---

## Comparison with ShineMonitor / Growatt

| Feature | ShineMonitor | Growatt | Victron VRM |
|---------|-------------|---------|-------------|
| Auth | SHA-1 signed GET + salt/token | Plaintext password, cookie session | Username/password **or** Personal Access Token (bearer-style header) |
| 2FA | Not observed | Not observed | Possible on user accounts — PAT sidesteps it |
| Session | Token-based, 5 min TTL (adapter-side cache) | `JSESSIONID` cookie, 4 min TTL | PAT has no session/expiry to manage; login-token lifetime unconfirmed |
| CORS | `access-control-allow-origin: *` | None — proxy required | None — proxy required (confirmed) |
| Device model | One device per plant (adapter assumes single device) | One `storageSn` per plant | **Multiple devices per site** (battery monitor, one+ solar chargers, VE.Bus/Quattro inverter) — see Feasibility below |
| Realtime shape | Bespoke `queryDeviceDataOneDay`-style fields | Flat `getStorageStatusData` object | Flat list of `{code, formattedValue, rawValue}` records across all devices |
| History | Paginated day query, dedicated pagination | Day chart + line chart + 7-day bat chart | `stats` endpoint with `interval` param — plausibly a single call covers what ShineMonitor/Growatt need two+ calls for |
| Official docs | None (reverse-engineered) | None (reverse-engineered) | **Yes** — public Swagger docs + first-party Python client, much lower reverse-engineering risk |

---

## Feasibility vs. normalized data contract (PLAN.md §3.1)

**Good fit:**

- `battery.soc`, general realtime polling model, and history via `interval`-based `stats`
  map onto the existing `fetchData` / `fetchHistory` / `fetchHistorySummary` contract
  without new frontend work.
- Official documentation and Python client sharply reduce reverse-engineering risk
  compared to the ShineMonitor/Growatt adapters, which were built from captured traffic
  alone.
- CORS behavior matches Growatt (proxy required) — no new architectural pattern needed,
  the existing Cloudflare Worker handles it.

**Gaps / open risks:**

1. **Multi-device sites.** ShineMonitor and Growatt each assume one inverter device per
   plant (`device` / `storageSn` stored once at setup). A typical Victron system reports
   as *separate devices* — a battery monitor (BMV/SmartShunt or Lynx Smart BMS), one or
   more solar charge controllers, and a VE.Bus/Quattro inverter/charger — each with its
   own `instance` number in `diagnostics`. `discover()` for a Victron adapter would need
   to build an **instance role map** (which `instance` is the battery monitor, which are
   solar chargers to sum, which is the AC inverter) at setup time, not just capture a
   single device serial. This is a materially bigger discovery step than the other two
   adapters and should be scoped as its own design pass before implementation.
2. **Unconfirmed attribute codes.** The exact `code` values for battery voltage/current
   and load/grid power were not confirmed from official docs during this spike (search
   results surfaced `SOC` and power-flow codes like `Pb`/`Pc`/`Bc` but not a complete,
   authoritative table). A real diagnostics dump against a test account is needed before
   writing adapter parsing logic.
3. **2FA accounts.** `discover()` cannot fully automate login for accounts with 2FA
   enabled; the setup flow would need to require a PAT for those users (or add a
   verification-code step, which the current `POST /api/systems` flow doesn't support).
4. **`grid.active` semantics.** Victron's grid/generator input handling (via a Multi or
   Quattro AC-in) is conceptually similar to ShineMonitor/Growatt but the exact fields
   need confirmation — relates to Open Question 3 in `PLAN.md` §13 (generator vs. grid
   labeling).
5. **No live verification.** Nothing in this document has been exercised against a real
   VRM account/token. Treat it as a literature-review-grade spike, not a validated spec.

**Net assessment:** Victron VRM is a **stronger long-term adapter candidate than initially
assumed** — official docs and an existing Python client lower implementation risk
significantly compared to how ShineMonitor/Growatt were built. The main new cost is the
multi-device discovery step, which the other two adapters don't need. See
`.gordofast/adr/` for the recorded decision and trade-offs.
