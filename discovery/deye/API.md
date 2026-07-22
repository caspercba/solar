# Deye / Solarman Cloud API Reference (Discovery Spike)

> Compiled from the official **Solarman OpenAPI** documentation
> ([doc.solarmanpv.com](https://doc.solarmanpv.com/en/Documentation%20and%20Quick%20Guide),
> OpenAPI PDF v1.1.x), the **DeyeCloud** developer portal +
> [sample code](https://github.com/DeyeCloudDevelopers/deye-openapi-client-sample-code),
> and community clients (`sincze/solarman-mqtt`, Home Assistant REST recipes).
> No live AppId was available, so **no plant traffic was captured** — treat
> response examples as **from vendor docs / samples**, not verified against a
> specific inverter. Confirm against current docs and a sandbox/test plant
> before writing production code.

## System Details

Unlike ShineMonitor/Growatt sections in this repo, there is no specific test
system here — this is a documentation-only spike (see README.md).

**Product naming:**

| Name | Role |
|------|------|
| **Solarman** (IGEN-Tech) | Cloud + Wi-Fi/LAN logger protocol used by many OEMs |
| **Deye / Sunsynk / Sol-Ark** | Inverter brands that commonly ship Solarman-family loggers |
| **DeyeCloud** | Deye-branded cloud + OpenAPI on regional developer hosts |

This spike targets the **cloud OpenAPI** (Worker-proxyable). Local Modbus over
Solarman V5 (`pysolarmanv5`, TCP 8899) is a separate LAN path and is **not**
covered here.

---

## 1. Authentication

Both Solarman and DeyeCloud use the same pattern: mint an OAuth2-style
**bearer access token** with developer app credentials + portal user password
(SHA-256 hex), then send `Authorization: bearer <access_token>` on every
data call (lowercase `bearer`, space after — required by docs).

### 1.1 Obtaining AppId / AppSecret

**Solarman OpenAPI**

1. Register / have a SOLARMAN Smart (or Merchant) account that can see the plant.
2. Email business contact or `service@solarmanpv.com` with contact info, customer
   type, and purpose — request developer application review.
3. After approval, create an application → receive `APP_ID` / `APP_SECRET`.
4. Token exchange uses that app + the **plant owner's** (or authorized user's)
   portal login.

**DeyeCloud OpenAPI**

1. Sign up at [deyecloud.com](https://www.deyecloud.com/login).
2. Open [developer.deyecloud.com/app](https://developer.deyecloud.com/app) and
   create an application → AppId / AppSecret (self-serve after account exists).
3. Support: `cloudservice@deye.com.cn`.

Unlike ShineMonitor/Growatt, end users cannot complete setup with **only** a
portal username/password — a developer app must exist first. That is the main
UX friction for an Add System modal (see §7).

### 1.2 Obtain token

**Solarman**

```
POST {base}/account/v1.0/token?appId={APP_ID}&language=en
Content-Type: application/json

{
  "appSecret": "<APP_SECRET>",
  "email": "<portal-email>",          // OR "username" OR "mobile" (+ countryCode)
  "password": "<sha256-hex-of-password>"
}
```

Optional `orgId` → merchant/business token (Merchant edition). Omit for
consumer (C-end) token.

**DeyeCloud** (paths relative to regional `/v1.0` base)

```
POST {base}/account/token?appId={APP_ID}
Content-Type: application/json

{
  "appSecret": "<APP_SECRET>",
  "email": "<portal-email>",
  "password": "<sha256-hex-of-password>",
  "companyId": "0"                    // optional; business when set
}
```

Password must be **SHA-256 hex of the UTF-8 plaintext** (not SHA-1 like
ShineMonitor). Multiple token calls do **not** invalidate prior tokens.

Example success (abbreviated from Solarman OpenAPI PDF):

```json
{
  "success": true,
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9…",
  "token_type": "bearer",
  "refresh_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9…",
  "expires_in": "5183999",
  "uid": 6681
}
```

### 1.3 Session lifetime

| Token | Typical lifetime | Notes |
|-------|------------------|-------|
| `access_token` | ~60 days (`expires_in` ≈ 5_183_999 s in docs) | Invalidated on password reset or role change |
| `refresh_token` | Present in Solarman responses | Prefer re-login with app+password if unsure; document refresh if implementing |

Compared with ShineMonitor (5 min) / Growatt (4 min cookie), Solarman/Deye
tokens are **long-lived** — a Worker can cache in memory for hours/days and
still store portal password (or SHA-256) in KV to re-mint when expired.

### 1.4 Authorization header

```
Authorization: bearer {access_token}
```

Docs insist on lowercase `bearer` and a trailing space. Community clients
follow this literally.

---

## 2. Base URL

### Solarman (classic OpenAPI)

| Data center | Host |
|-------------|------|
| China | `https://api.solarmanpv.com` |
| International | `https://globalapi.solarmanpv.com` |

Paths include the version segment, e.g. `/station/v1.0/list`.

### DeyeCloud (developer OpenAPI)

| Region | Base (includes `/v1.0`) |
|--------|-------------------------|
| EU | `https://eu1-developer.deyecloud.com/v1.0` |
| US | `https://us1-developer.deyecloud.com/v1.0` |

Paths are relative to that base, e.g. `/station/list` (not `/station/v1.0/list`).

Pick the host that matches where the plant was commissioned. Wrong region →
empty lists or auth errors.

---

## 3. CORS / Browser Access

Designed for server-to-server use. No useful CORS for a static frontend;
AppSecret + portal password must not ship to the browser. **Worker proxy is
required** (same architectural reason as Growatt / Solis / SMA).

---

## 4. Endpoints — Discovery

All authenticated calls are `POST` + JSON body unless noted. Response envelope
generally includes `success`, `code`, `msg`, `requestId`.

### 4.1 Station list

| Flavor | Path | Body |
|--------|------|------|
| Solarman | `/station/v1.0/list` | `{ "page": 1, "size": 50 }` |
| DeyeCloud | `/station/list` | `{ "page": 1, "size": 10 }` |

Example station fields (Solarman PDF sample):

```json
{
  "id": 895,
  "name": "001_OPENAPI_报警",
  "regionTimezone": "PRC",
  "type": "HOUSE_ROOF",
  "gridInterconnectionType": "BATTERY_BACKUP",
  "installedCapacity": 6754.0,
  "batterySoc": 56.0,
  "networkStatus": "ALL_OFFLINE",
  "generationPower": 678.0,
  "lastUpdateTime": 1580621692.0
}
```

`discover()` would map `id` → `plantId`, `name` → `plantName`,
`installedCapacity` → `nominalPower` (confirm whether value is W or kW × 1000
against a live plant — PDF examples look like watts-scale numbers). Multi-plant
accounts fit `requiresPlantSelection` (ADAPTER_GUIDE.md §3.3).

### 4.2 Devices under a station

| Flavor | Path | Body |
|--------|------|------|
| Solarman | `/station/v1.0/device` | `{ "stationId": 895, "page": 1, "size": 10, "deviceType": "INVERTER" }` |
| DeyeCloud | `/station/device` | `{ "stationIds": [10], "page": 1, "size": 10 }` |

`deviceType` values (Solarman enum docs): `INVERTER`, `COLLECTOR`, `METER`,
`PV_MODULE`, `COMBINER_BOX`, `WEATHER_STATION`, `SMART_METER`, …

Store inverter `deviceSn` (and optionally collector SN) in KV for device-level
calls. Station-level realtime is often enough for the dashboard contract.

### 4.3 Station base / detail (optional)

Solarman: `POST /station/v1.0/base` with `{ "stationId": … }` — address,
capacity, interconnection type, etc.

---

## 5. Endpoints — Realtime

### 5.1 Preferred for dashboard: station realtime

| Flavor | Path | Body |
|--------|------|------|
| Solarman | `/station/v1.0/realTime` | `{ "stationId": 895 }` |
| DeyeCloud | `/station/latest` | `{ "stationId": 10 }` |

Solarman PDF example:

```json
{
  "success": true,
  "generationPower": 678.0,
  "usePower": 678.0,
  "gridPower": null,
  "purchasePower": -678.0,
  "wirePower": -678.0,
  "chargePower": -678.0,
  "dischargePower": null,
  "batteryPower": -678.0,
  "batterySoc": 56.0,
  "irradiateIntensity": 236.18,
  "lastUpdateTime": 1580621692.0
}
```

DeyeCloud sample responses cite the same conceptual fields
(`generationPower`, `gridPower`, `batterySOC` / `batterySoc` — confirm exact
casing on a live call).

**Update cadence:** cloud push from the logger is typically on the order of
**1–5 minutes** (community reports; Deye support can raise frequency in some
regions). Polling every 60 s will often repeat the same snapshot — acceptable
for glanceable UI, not second-by-second.

### 5.2 Device realtime (detail / fallback)

| Flavor | Path | Body |
|--------|------|------|
| Solarman | `/device/v1.0/currentData` | `{ "deviceSn": "…" }` (optional `deviceId`) |
| DeyeCloud | `/device/latest` | `{ "deviceList": ["SN1", "SN2"] }` (max 10) |

Solarman returns a `dataList[]` of `{ key, name, unit, value }` — **keys are
model-dependent** (e.g. `DV1` DC Voltage PV1, `DPi_t1` Total DC Input Power,
`PG_Pt1` Total Grid Power). Do **not** hard-code array indexes (HA recipes
that use `dataList[16]` break across firmware). Prefer matching by `key` or
localized `name`, or stick to station realtime for the normalized contract.

### 5.3 Field → normalized contract (PLAN.md §3.1)

| Normalized field | Station realtime source | Notes |
|------------------|-------------------------|-------|
| `solar.power` | `generationPower` | W |
| `load.power` | `usePower` | Household consumption |
| `battery.soc` | `batterySoc` / `batterySOC` | %; `socSource: "api"` |
| `battery.power` | Prefer `batteryPower`; else `dischargePower - chargePower` | PDF sample: `batteryPower: -678` while charging (`chargePower` also negative) — **appears to match** PLAN sign (negative = charging). **Verify live** before shipping |
| `battery.voltage` / `current` | Device `dataList` keys | Optional second call |
| `grid.power` | Prefer `purchasePower` or `wirePower`; else `gridPower` | Sign/meaning of export vs import varies; confirm against plant |
| `grid.active` | `\|purchasePower\| > 5` or `\|wirePower\| > 5` (and/or voltage from device) | Same heuristic style as Growatt |
| `grid.voltage` | Device AC voltage keys | Optional |
| `energyToday` | History day totals (`generationValue` / generation kWh) | Not always on realtime payload |
| `status` | Device `deviceState` (1 online / 2 alarm / 3 offline) or networkStatus | Map to human label |
| `inverter.nominalPV` / `ratedPower` | `installedCapacity` from station list/base | Unit check required |

Absent battery/grid keys on PV-only plants → omit / null-safe like SMA/Solis.

---

## 6. Endpoints — History

### 6.1 Intraday (`fetchHistory`)

| Flavor | Path | Granularity |
|--------|------|-------------|
| Solarman | `/station/v1.0/history` | `timeType: 1` (frame), `startTime`/`endTime` as `yyyy-MM-dd` |
| DeyeCloud | `/station/history` | `granularity: 1`, `startAt: "yyyy-MM-dd"` (frame = power series for that day) |

Suggested point mapping from `stationDataItems[]` (Solarman field names):

| History point | Source |
|---------------|--------|
| `time` | Local `HH:MM` from `dateTime` / collect timestamp (plant `regionTimezone`) |
| `solar` | `generationPower` |
| `load` | `usePower` |
| `battery` | `batteryPower` (or discharge − charge) |
| `soc` | `batterySoc` when present |

Device-level alternative: Solarman `/device/v1.0/historical` or DeyeCloud
`/device/history` with `measurePoints` (e.g. `["SOC","batteryPower","pvPower"]`
— list available points via DeyeCloud `/device/measurePoints`).

### 6.2 Multi-day summary (`fetchHistorySummary`)

| Flavor | Body highlights |
|--------|-----------------|
| Solarman | `timeType: 2` (day), `startTime`/`endTime` up to ~30 days → `generationValue`, `useValue`, `batterySoc`, charge/discharge kWh |
| DeyeCloud | `granularity: 2`, `startAt`/`endAt` up to 31 days |

Example Solarman day row (abbreviated PDF):

```json
{
  "generationValue": 1788.0,
  "useValue": 1608.0,
  "chargeValue": 1608.0,
  "dischargeValue": 0.0,
  "batterySoc": null,
  "year": 2019,
  "month": 12,
  "day": 23
}
```

Map to summary `solarKwh` / `loadKwh` / `minSoc` / `maxSoc` (`source: "vendor"`).
SOC min/max may be sparse on day aggregates — fall back to frame series or
device history if needed.

---

## 7. Rate Limits & Quotas

From Solarman OpenAPI quick guide (current doc.solarmanpv.com):

- **Default:** max **300 requests / 10 seconds** per OpenAPI account.
- Device **control** interfaces: max **50 / minute**.
- Endpoint **13** — query remaining call quotas for an APPID (ops monitoring).

Older PDF copies also cite ~2000 / min for realtime and historical interfaces —
treat the **published web guide** as authoritative and ask Solarman/Deye
support for the limit tied to your AppId.

For this dashboard's 60 s poll + occasional history pulls, limits are unlikely
to bind for a few systems. Fan-out in `fetchHistorySummary` should still be
paced if using N device day calls instead of one station day range.

---

## 8. Comparison With Other Brands

| Feature | ShineMonitor | Growatt | Solis (spike) | SMA (spike) | Deye/Solarman (this spike) |
|---------|-------------|---------|---------------|-------------|----------------------------|
| API status | Undocumented portal | Undocumented portal | Official HMAC API | Official OAuth2 + OpenAPI | **Official OpenAPI (Solarman + DeyeCloud)** |
| Auth | SHA-1 signed GET | Cookie session | HMAC API key | OAuth2 + owner consent | **AppId/Secret + SHA-256 password → bearer (~60 d)** |
| Onboarding | Portal user/password | Same | Manual key activation | Support + contract + consent | **Create developer app, then portal user** |
| CORS | Open (`*`) | None | N/A (B2B) | None | **None (proxy required)** |
| Battery SOC | API or voltage est. | Direct | Direct | Direct | **Direct (`batterySoc`)** |
| History | Day paging | Day charts | Day/Month/Year | Day/Week/Month/Year | **Frame/Day/Month/Year station + device** |
| Rate limit | Undocumented | Undocumented | 3 / 5 s / IP | Token bucket / 5 min | **~300 / 10 s (account)** |
| Cost | Free (portal) | Free (portal) | Free (after key) | Commercial API fees | **Free OpenAPI after AppId (confirm with vendor)** |

---

## 9. Spike Conclusion — Adapter Viability

**Technically viable.** Plant-level realtime covers solar, load, battery SOC/
power, and grid signals in one call — a good fit for PLAN.md §3. History
supports both intraday frames and multi-day energy totals without inventing a
KV archive. Token lifetime is friendly to Worker session caching. DeyeCloud
self-serve apps are easier to obtain than SMA's B2B contract path.

**Reasons to defer building now (PLAN.md §12 Phase 5 = TBD by user need):**

1. **Onboarding still needs an AppId.** Today's Add System modal is
   `service + user + password`. Solarman requires a reviewed developer app;
   DeyeCloud is self-serve but still an extra portal step. Options for a
   future adapter: (a) operator-held shared AppId in Worker secrets + user
   enters only portal email/password, or (b) extra form fields for AppId/
   AppSecret per system.
2. **No live validation.** Battery/grid **sign conventions** and
   `installedCapacity` units are inferred from PDF samples — same risk called
   out for Solis/SMA. Wrong charge/discharge direction would silently break
   the flow diagram.
3. **Two hosts / path dialects.** Production code must select Solarman vs
   DeyeCloud (and China vs intl / EU vs US) — either a setup dropdown or
   auto-detect. Device `dataList` keys are model-specific; prefer station
   endpoints for normalize.
4. **Cloud latency.** Logger → cloud refresh is often multi-minute; fine for
   glanceable monitoring, weaker than local V5 Modbus for "live" control.

**Recommendation:** revisit when a user with (a) Solarman AppId or DeyeCloud
developer app and (b) a hybrid plant volunteers. Capture redacted
`realTime`/`latest` + day/frame history fixtures, decide shared vs per-user
AppId, then implement `discover` / `fetchData` / `fetchHistory` /
`fetchHistorySummary` per ADAPTER_GUIDE.md §11. Prefer **station** endpoints
for the normalized contract; use device latest only for voltage/detail.

---

## 10. Sources

- [Solarman OpenAPI — Documentation and Quick Guide](https://doc.solarmanpv.com/en/Documentation%20and%20Quick%20Guide)
  — access process, hosts, call limits, token notes
- Solarman OpenAPI PDF (community mirrors, e.g. Global v1.1.6 / v1.1.7 EN) —
  endpoint tables and JSON samples for token, list, realTime, history,
  currentData
- [DeyeCloud Developer Portal](https://developer.deyecloud.com/) — apps,
  QuickStart, API catalogue
- [DeyeCloudDevelopers/deye-openapi-client-sample-code](https://github.com/DeyeCloudDevelopers/deye-openapi-client-sample-code)
  — token, station list/latest/history, device latest/history
- [sincze/solarman-mqtt](https://github.com/sincze/solarman-mqtt) — practical
  curl flow against `globalapi.solarmanpv.com`
- Home Assistant community: Solarman REST + DeyeCloud threads (logger vs
  cloud; update intervals)
- Local LAN alternative (not this spike): [jmccrohan/pysolarmanv5](https://github.com/jmccrohan/pysolarmanv5),
  [StephanJoubert/home_assistant_solarman](https://github.com/StephanJoubert/home_assistant_solarman)
