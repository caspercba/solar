# SMA Monitoring / Live API Reference (Discovery Spike)

> Compiled from the official **SMA Developer Portal**
> ([developer.sma.de](https://developer.sma.de/)), published OpenAPI for
> Monitoring (`sandbox.smaapis.de/monitoring/swagger/v1/swagger.json`) and
> Live (`sandbox.smaapis.de/live/swagger/v1/swagger.json`), the Access Control
> / FAQ / Sandbox pages, and community notes (e.g. evcc discussion #7403).
> No SMA client credentials were available, so **no live traffic was
> captured** — treat response examples as **from OpenAPI samples / docs**,
> not verified against a real plant. Confirm against current Swagger and a
> sandbox account before writing production code.

## System Details

Unlike ShineMonitor/Growatt sections in this repo, there is no specific test
system here — this is a documentation-only spike (see README.md).

**Portal backends covered by one Monitoring API:**

| Backend | Portal UI | Plant ID format | Typical refresh |
|---------|-----------|-----------------|-----------------|
| Sunny Portal **Classic** | `www.sunnyportal.com` | GUID (`8-4-4-4-12`) | Up to ~2 h (or ~15 min with Professional package) |
| Sunny Portal powered by **ennexOS** | `ennexos.sunnyportal.com` | Numeric string | ~5 min (Data Manager default) |

The API consumer does **not** choose a backend — both appear in
`GET /v1/plants`. Classic vs ennexOS is inferred from the plant ID shape.

Legacy reverse-engineered scrapers against `sunnyportal.com` login forms /
`/homemanager` JSON are **obsolete** (auto-login disabled; endpoint removed).
Do not build an adapter on that path.

---

## 1. Authentication

SMA uses **OAuth2**. Third parties never store the plant owner's portal
password for API access — they hold **application client credentials** issued
by SMA, then obtain **user consent** per resource owner.

### 1.1 Obtaining credentials

1. Contact **API Developer Support** (`api-developer-support@sma.de` or the
   Developer Portal contact form).
2. Provide app logo URL, service terms URL, privacy policy URL, and (for code
   grant) a redirect URI — these appear on the consent screen.
3. Receive **sandbox** `client_id` / `client_secret`; explore Swagger +
   Postman collection.
4. Sign the commercial contract; SMA creates **production** credentials.
5. Ensure each plant has a designated **system owner** (Classic: User
   Management → system-owner flag; ennexOS: owner role).

There is no self-service "enter your Sunny Portal password" flow like
ShineMonitor/Growatt; **this is the main integration friction** (see §7).

### 1.2 Hosts

| Role | Sandbox | Production |
|------|---------|------------|
| Authorization / token | `https://sandbox-auth.smaapis.de` | `https://auth.smaapis.de` |
| Backchannel consent | `https://sandbox.smaapis.de` | `https://async-auth.smaapis.de` |
| Monitoring API | `https://sandbox.smaapis.de/monitoring` | `https://monitoring.smaapis.de` |
| Live API | `https://sandbox.smaapis.de/live` (docs only; no sandbox data) | `https://live.smaapis.de` |

### 1.3 Flow A — Authorization Code Grant (end-user / on-screen)

For apps where the plant owner is present (e.g. "Connect SMA" button):

1. Browser redirect to `{auth}/oauth2/auth?client_id=…&response_type=code&redirect_uri=…&state=…`
2. Owner logs in and consents.
3. Back-channel `POST {auth}/oauth2/token` with
   `grant_type=authorization_code` + `code` + `client_secret`.
4. Receive `access_token` (~300 s) + `refresh_token` (default ~2 days;
   `scope=offline_access` yields a non-expiring offline refresh token).

Access is limited to systems of the authenticated owner.

### 1.4 Flow B — Custom / backchannel grant (O&M — likely for this dashboard)

For server-side monitoring where the owner is off-screen (closest match to our
Worker proxy model):

**Step 1 — Client token**

```
POST {auth}/oauth2/token
Content-Type: application/x-www-form-urlencoded

client_id={id}&client_secret={secret}&grant_type=client_credentials
```

**Step 2 — Request owner consent**

```
POST {bc}/oauth2/v2/bc-authorize
Authorization: Bearer {client_token}
Content-Type: application/json

{ "loginHint": "owner@example.com" }
```

SMA emails the owner a consent link (valid ~7 days). Response includes
`state: "pending"` and a suggested poll `interval` (docs cite 1800 s).

**Step 3 — Poll consent**

```
GET {bc}/oauth2/v2/bc-authorize/{loginHint}
Authorization: Bearer {client_token}
```

States: `pending` | `accepted` | `rejected` | `expired` | `revoked`.
Only `accepted` unlocks plant data. Without consent, Monitoring calls return
**empty** plant lists (not necessarily 403).

**Sandbox simulation:**

```
PUT sandbox.smaapis.de/oauth2/v2/bc-authorize/apiTestUser@apiSandbox.com/status
Body: "accepted"   # or "reject" / "revoked"
```

Sandbox login for code-grant tests: `apiTestUser@apiSandbox.com` /
`MyPass123!` (published on the Sandbox APIs page — not a secret).

**Step 4 — Token refresh**

```
POST {auth}/oauth2/token
grant_type=refresh_token&refresh_token=…&client_id=…&client_secret=…
```

Logout: `POST {auth}/oauth2/logout` with the same form fields.

**Reference implementation (Python, stdlib only):** see [fetch_data.py](fetch_data.py)
(client-credentials + Monitoring calls; consent steps are documented but
optional env-driven helpers).

### 1.5 Session lifetime

| Token | Typical lifetime | Notes |
|-------|------------------|-------|
| Access token | ~300 s (`expires_in`) | Short; refresh before each poll wave if needed |
| Refresh token | ~2 days (`refresh_expires_in`) | Extend session; max ~30 days without offline scope |
| Offline refresh | `refresh_expires_in: 0` | Request `scope=offline_access` |

Unlike ShineMonitor/Growatt, there is no portal password to cache in KV for
re-login. A production adapter would store **refresh_token** (and optionally
`client_id`/`client_secret` at the Worker/app level — shared across users —
plus per-system `plantId` and owner `loginHint`).

---

## 2. CORS / Browser Access

SMA **does not allow CORS** for API resource servers. Browser calls from a
static frontend will fail the preflight. Even if they did not, `client_secret`
must never ship to the browser. **A server-side proxy (the Worker) is
required** — same architectural reason as Growatt.

---

## 3. Endpoints — Discovery

All Monitoring calls use:

```
Authorization: Bearer {access_token}
Accept: application/json
```

### 3.1 Plant list

```
GET /v1/plants
  ?WithStatus=true
  &WithInstallation=true
  &WithLocation=true
  &Filter=optional-name
```

Returns plants the token is permitted to see. Empty list ⇒ missing or incomplete
owner consent (custom flow) or wrong user (code grant).

### 3.2 Plant detail / devices

```
GET /v1/plants/{plantId}
GET /v1/plants/{plantId}/status
GET /v1/plants/{plantId}/installation   # capacity / install metadata
GET /v1/plants/{plantId}/devices        # obsolete-tagged but still listed
GET /v1/plants/{plantId}/devices/lean   # ennexOS preferred
GET /v1/plants/{plantId}/capabilities
```

`discover()` would pick `plantId`, timezone, and nominal power from
installation/capabilities (exact field names: confirm in Swagger `Plant` /
`PlantInstallation` schemas against a live response).

Multi-plant accounts map naturally to the existing
`requiresPlantSelection` flow (ADAPTER_GUIDE.md §3.3).

---

## 4. Endpoints — Realtime

### 4.1 Preferred for O&M: Monitoring `EnergyBalance` / `Recent`

```
GET /v1/plants/{plantId}/measurements/sets/EnergyBalance/Recent
```

OpenAPI sample (abbreviated):

```json
{
  "plant": {
    "plantId": "25057",
    "name": "Test Plant",
    "description": "Test Plant Description",
    "timezone": "Europe/Berlin"
  },
  "setType": "EnergyBalance",
  "resolution": "FiveMinutes",
  "set": [
    {
      "time": "2020-03-23T12:40:00",
      "pvGeneration": 3110.263,
      "directConsumption": 3512.402,
      "totalConsumption": 3914.541,
      "batteryCharging": 0,
      "batteryDischarging": 0,
      "batteryStateOfCharge": 65.25,
      "dieselGeneration": 402.139,
      "gridFeedIn": 396.455,
      "gridConsumption": 402.139,
      "totalGeneration": 3908.857,
      "selfConsumption": 3512.402,
      "autarkyRate": 0.897,
      "selfConsumptionRate": 0.899,
      "selfSupply": 3512.402
    }
  ]
}
```

For `Recent` / `Day` / `Week`, power fields are in **W**; `Month` / `Year` /
`Total` switch to **Wh** energy.

**Update cadence:** ennexOS ≈ 5 min; Classic without Pro package can lag up to
~2 hours. Polling every 60 s (current dashboard default) will often repeat the
same `Recent` snapshot — acceptable, but not "live second-by-second".

### 4.2 Live API (classic only — not for constant monitoring)

```
GET https://live.smaapis.de/v1/plants/{plantId}/measurements/sets/EnergyBalance
```

Same `EnergyBalance` field shape; near-time from the device channel.
Constraints from the Live OpenAPI description:

- Classic **Home Manager** and **WebConnect** only (not Webbox / Cluster
  Controller; sandbox has **no** Live data — ennexOS-only mocks).
- Check `/v1/plants/{plantId}/configuration` before assuming Live support.
- Do **not** poll more often than every **10 seconds**.
- Terminate a live poll session after at most **~10 minutes**.
- Explicitly: **do not use Live for constant O&M / monitoring** — use
  Monitoring API instead.

For Solar Dashboard's 60 s poll model, **Monitoring `Recent` is the correct
source**; Live is optional polish for classic plants during an interactive
session only.

### 4.3 Field → normalized contract (PLAN.md §3.1)

| Normalized field | SMA `EnergyBalance` source | Notes |
|------------------|----------------------------|-------|
| `solar.power` | `pvGeneration` | W on Recent |
| `load.power` | `totalConsumption` | Household load |
| `battery.soc` | `batteryStateOfCharge` | %; `socSource: "api"` |
| `battery.power` | `batteryDischarging - batteryCharging` | Matches sign convention: **negative = charging**, positive = discharging |
| `battery.voltage` / `current` | Device `PowerDc` / battery arrays (ennexOS) | Not on plant EnergyBalance; optional second call |
| `grid.power` | `gridConsumption - gridFeedIn` | Or prefer `dieselGeneration` when > threshold for off-grid gen |
| `grid.active` | `dieselGeneration > 5` **or** `\|gridConsumption\| + \|gridFeedIn\|` with voltage if available | Diesel field is unusually useful for PLAN "Generator" UX |
| `grid.voltage` | Device `PowerAc` | Optional |
| `energyToday` | `Day` period + `WithTotal=true` → `total.pvGeneration` / 1000 | Confirm Wh vs W for Day totals |
| `status` | `GET …/status` or Live status enum | Map to human label |
| `inverter.nominalPV` / `ratedPower` | Installation / device nameplate | From discovery |

Missing properties are **omitted** from the result set (not null) — adapters
must tolerate absent battery/grid keys on PV-only plants.

---

## 5. Endpoints — History

### 5.1 Intraday / week (`fetchHistory`)

```
GET /v1/plants/{plantId}/measurements/sets/EnergyBalance/Day?Date=2026-07-03
GET /v1/plants/{plantId}/measurements/sets/EnergyBalance/Week?Date=2026-07-03
```

Returns an array of timestamped points at the highest available resolution
(5 min / 15 min / 1 h — plant-dependent). You cannot request a fixed
resolution; use point timestamps when integrating W → kWh
(`computeDailySummary` in `worker/src/history.js`).

Suggested point mapping:

| History point | Source |
|---------------|--------|
| `time` | Local `HH:MM` from `set[].time` (plant timezone) |
| `solar` | `pvGeneration` |
| `load` | `totalConsumption` |
| `battery` | `batteryDischarging - batteryCharging` |
| `soc` | `batteryStateOfCharge` |

Device-level alternatives when plant EnergyBalance is thin:

```
GET /v1/devices/{deviceId}/measurements/sets/EnergyAndPowerPv/Day?Date=…
GET /v1/devices/{deviceId}/measurements/sets/EnergyAndPowerBattery/Day?Date=…
GET /v1/devices/{deviceId}/measurements/sets/EnergyAndPowerConsumption/Day?Date=…
GET /v1/devices/{deviceId}/measurements/sets/EnergyAndPowerInOut/Day?Date=…
```

### 5.2 Multi-day summary (`fetchHistorySummary`)

```
GET /v1/plants/{plantId}/measurements/sets/EnergyBalance/Month?Date=2026-07
  &WithTotal=true
```

Day-resolution rows for the month (energy in Wh) — better than N × Day
round-trips for a 7-day bar chart. SOC min/max: Day/Week series include
`batteryStateOfCharge` (ennexOS); Classic may lack some SOC arrays.

---

## 6. Rate Limits & Commercial Model

- From **2025-07-01**, SMA applies a **per-credential token-bucket limit** over
  a **5-minute** window. Exceeding it returns **HTTP 429**. `Retry-After` is
  **not** sent (sliding window). Exact token counts are package-specific —
  ask Developer Support for the limit tied to your credentials.
- Live API: soft guidance ≤ 1 call / 10 s; not for continuous monitoring.
- **Billing:** SMA charges a **per-system monthly** fee based on capacity
  (API price model / calculator on sma.de). This is a **product/ops** concern
  beyond code — a free hobbyist dashboard cannot silently absorb SMA API fees
  for end users.

---

## 7. Comparison With ShineMonitor / Growatt / Solis

| Feature | ShineMonitor | Growatt | Solis (spike) | SMA (this spike) |
|---------|-------------|---------|---------------|------------------|
| API status | Undocumented portal | Undocumented portal | Official B2B spec | **Official OAuth2 REST + OpenAPI** |
| Auth | SHA-1 signed GET | Cookie session | HMAC-SHA1 API key | **OAuth2 client + owner consent** |
| Onboarding | Portal user/password | Same | Manual key activation | **Support ticket + contract + consent email** |
| CORS | Open (`*`) | None | N/A (B2B) | **None (proxy required)** |
| Battery SOC | API or voltage est. | Direct | Direct | **Direct (`batteryStateOfCharge`)** |
| Generator | Grid V/W heuristic | Same | Grid import/export | **`dieselGeneration` + grid fields** |
| History | Day paging | Day charts | Day/Month/Year | **Day/Week/Month/Year/Total** |
| Rate limit | Undocumented | Undocumented | 3 req / 5 s / IP | **Token bucket / 5 min + Live soft limits** |
| Cost to operator | Free (portal) | Free (portal) | Free (after key) | **Commercial per-system API fees** |

---

## 8. Spike Conclusion — Adapter Viability

**Technically viable and well-documented.** Plant-level `EnergyBalance`
covers solar, load, battery SOC/power, grid, and diesel in one call — a better
fit for PLAN.md §3 than many undocumented portals. OpenAPI schemas reduce
fixture risk versus Solis's field-name ambiguity.

**Reasons to defer building now (PLAN.md §12 Phase 5 = TBD by user need):**

1. **Onboarding UX regression.** Today's Add System modal is
   `service + user + password`. SMA needs Worker-held `client_id`/`client_secret`
   (app-level, from SMA Support), then a **consent email** to the plant owner
   (`loginHint`) with pending/accepted polling — multi-step and async. Code
   grant would need a redirect URI and browser round-trip.
2. **Commercial gate.** Production access requires a signed contract and
   incurs per-system monthly API charges. Unsuitable as a default free adapter
   for individual homeowners without a pricing/pass-through decision.
3. **No live validation.** Without sandbox credentials, parsers and sign
   conventions (especially battery power and Wh vs W on Day totals) are
   unverified — same risk called out for Solis.
4. **Classic latency.** Many existing SMA residential installs are Classic
   WebConnect / Home Manager with up to ~2 h data lag unless Pro package is
   purchased — poor match for a "glanceable realtime" phone dashboard unless
   the plant is ennexOS (or Live is used carefully for interactive sessions).

**Recommendation:** revisit when (a) a user with SMA Developer sandbox or
production credentials volunteers, and (b) product decides whether SMA API
fees are absorbed, passed through, or limited to installer/O&M tenants. At
that point: capture redacted `EnergyBalance` Recent/Day fixtures, implement
`discover` / `fetchData` / `fetchHistory` / `fetchHistorySummary` per
ADAPTER_GUIDE.md §11, and prefer Monitoring over Live for the 60 s poll loop.

---

## 9. Sources

- [SMA Developer Portal](https://developer.sma.de/) — get started, API catalogue
- [API Access Control](https://developer.sma.de/api-access-control) — OAuth2
  code grant, custom backchannel grant, token handling, CORS note
- [SMA Sandbox APIs](https://developer.sma.de/sma-sandbox-apis) — test user,
  consent simulation, Postman collection
- [FAQ](https://developer.sma.de/faq) — Classic vs ennexOS refresh rates,
  plant ID formats, empty responses without consent, billing glossary
- [Rate limit announcement](https://developer.sma.de/announcements/ratelimit)
  (effective 2025-07-01)
- Monitoring OpenAPI: `https://sandbox.smaapis.de/monitoring/swagger/v1/swagger.json`
  (production host `https://monitoring.smaapis.de`)
- Live OpenAPI: `https://sandbox.smaapis.de/live/swagger/v1/swagger.json`
  (production host `https://live.smaapis.de`)
- Community: [evcc-io/evcc#7403](https://github.com/evcc-io/evcc/discussions/7403)
  — Live `EnergyBalance` example and polling notes
- Historical scrapers (do **not** use): pimatic Sunny Portal scripts,
  `erdtman/sunnyportal-api` — broken after SMA disabled auto-login
