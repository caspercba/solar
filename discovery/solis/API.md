# SolisCloud API Reference (Discovery Spike)

> Compiled from the official **SolisCloud Platform API Document** (v2.0.x,
> published by Ginlong Technologies at `doc.soliscloud.com` /
> `oss.soliscloud.com`), the Solis support knowledge base, and field/endpoint
> names cross-checked against community client implementations
> (`hultenvp/soliscloud_api` and forks). No live account was available, so no
> traffic was captured for this spike — treat field lists as **best-effort
> from documentation**, not verified against a real inverter. Confirm against
> the current PDF spec (linked from Solis support) before writing production
> code.

## System Details

Unlike ShineMonitor/Growatt sections in this repo, there is no specific test
system here — this is a documentation-only spike (see README.md).

---

## 1. Authentication

SolisCloud does **not** use username/password + session cookie like
ShineMonitor/Growatt. It uses a **request-signing scheme** similar to AWS S3 /
Aliyun OSS: every request is signed with an `API Key ID` + `API Key Secret`
issued per SolisCloud account.

### 1.1 Obtaining credentials

1. Account owner logs in to `soliscloud.com` (or a regional equivalent).
2. **API Management** → **Activate now** → agree to terms.
3. **View Key** → solve puzzle captcha → verification code emailed (short TTL).
4. Approval by Solis (may route through a regional support/installer contact).
5. Dashboard reveals `KeyId` and `KeySecret` — scoped to that account's plants.

There is no self-service "enter your portal password" flow like the other two
adapters; **this is the main integration friction** (see §7).

### 1.2 Request signing

Every API call is a signed `POST` with a JSON body. Required headers:

| Header | Value |
|--------|-------|
| `Content-MD5` | Base64 of the MD5 digest of the raw JSON request body |
| `Content-Type` | `application/json;charset=UTF-8` |
| `Date` | Current time, RFC 1123 / GMT format, e.g. `Mon, 01 Jun 2026 12:00:00 GMT` |
| `Authorization` | `API ` + `KeyId` + `:` + `Sign` (see below) |

**Signature:**

```
StringToSign = VERB + "\n" +
               Content-MD5 + "\n" +
               Content-Type + "\n" +
               Date + "\n" +
               CanonicalizedResource

Sign = Base64( HMAC-SHA1( KeySecret, StringToSign ) )
```

- `VERB` is the HTTP method, always `POST` for data endpoints.
- `CanonicalizedResource` is the request path only, e.g. `/v1/api/userStationList`
  (no query string, no host).
- Clock skew matters: community clients report `HTTP 408`-style auth failures
  when the local clock drifts more than ~15 minutes from server time — use
  NTP-synced time when implementing this for real.

**Reference implementation (Python, stdlib only):** see [fetch_data.py](fetch_data.py).

### 1.3 Session lifetime

There is no session/token to cache — every request is signed fresh with the
static key/secret. This is actually **simpler** than ShineMonitor's
token+secret refresh or Growatt's cookie expiry: no `getSession()` /
re-login logic needed, just re-sign per request.

---

## 2. Base URL

```
https://www.soliscloud.com:13333
```

Solis support has, in some cases, assigned integrators a different regional
host at approval time — treat the base URL as **account-specific
configuration**, not a hardcoded constant, if this becomes a real adapter.

---

## 3. CORS / Browser Access

No CORS headers are documented or expected — this API is designed for
server-to-server B2B integration, not browser JS. Even if CORS were open, the
`KeySecret` must never be shipped to a browser (it signs every request, same
trust level as a password). **A server-side proxy (the Worker) is required**,
for the same reason as Growatt — just "protect the secret," not "work around
a missing CORS header."

---

## 4. Endpoints

All endpoints are `POST` with a JSON body, `Content-Type:
application/json;charset=UTF-8`, and the signed headers from §1.2. Responses
share an envelope:

```json
{ "success": true, "code": "0", "msg": "success", "data": { /* or [] */ } }
```

### 4.1 Discovery

#### Power Station List

```
POST /v1/api/userStationList
Body: { "pageNo": 1, "pageSize": 20 }
```

Returns paginated stations for the account — plant id, name, capacity,
timezone.

#### Power Station Detail

```
POST /v1/api/stationDetail
Body: { "id": "<stationId>" }
```

Returns station-level totals (today/month/year/all energy) and metadata
(install capacity, address, timezone).

#### Inverter List

```
POST /v1/api/inverterList
Body: { "stationId": "<stationId>", "pageNo": 1, "pageSize": 20 }
```

Returns inverters/devices under a station — inverter id, SN, model, rated
power. (`inverterList` with no `stationId` returns all inverters for the
account; `inverterDetailList` returns detail for all inverters in one call.)

### 4.2 Realtime

#### Inverter Detail

```
POST /v1/api/inverterDetail
Body: { "id": "<inverterId>" }   // or { "sn": "<inverterSn>" }
```

**Fields relevant to normalization** (names per spec/community clients —
**unverified against live traffic**):

| Field | Description | Unit |
|-------|-------------|------|
| `pac` | AC output power (total) | kW (see `pacStr`/`pacPec` scale hints) |
| `uPv1`…`uPv4` | PV string voltage | V |
| `iPv1`…`iPv4` | PV string current | A |
| `pow1`…`pow4` | PV string power (undocumented in spec, seen in practice) | kW |
| `batteryCapacitySoc` | Battery SOC | % |
| `batteryPower` (`batteryPowerFu`/`batteryPowerZheng` variants seen) | Battery power, sign varies by field variant | kW |
| `batteryVoltage` | Battery voltage | V |
| `familyLoadPower` | Household load power | kW |
| `gridPurchasedTodayEnergy` | Grid import today | kWh |
| `gridSellTodayEnergy` | Grid export today | kWh |
| `homeLoadTodayEnergy` | Load consumption today | kWh |
| `eToday` / `eMonth` / `eYear` / `eTotal` | PV energy produced | kWh |
| `state` | Inverter run status code | int |
| `dataTimestamp` | Last update, epoch ms | ms |

Several field name variants exist across spec versions (e.g.
`batteryPowerFu`/`batteryPowerZheng` for charge/discharge split vs a single
signed `batteryPower`) — **a real adapter needs a live account to confirm
which variant a given firmware/portal version actually returns**, and whether
units are kW (as the spec implies via `pacStr: "kW"`) or W. This ambiguity is
one reason this spike stops short of an adapter (§7).

### 4.3 History

#### Inverter Day

```
POST /v1/api/inverterDay
Body: { "id": "<inverterId>", "money": "USD", "time": "2026-07-03", "timeZone": -6 }
```

Returns a `data` array of intraday points:

```json
{
  "success": true,
  "data": [
    {
      "dataTimestamp": "1687813291000",
      "timeStr": "2023-06-27 05:01:31",
      "time": "05:01:31",
      "pac": 74.0,
      "pacStr": "kW",
      "eToday": 0.0,
      "eTotal": 36362.0,
      "uPv1": 245.3,
      "iPv1": 0.1
    }
  ]
}
```

Sample interval looks event-driven / irregular in captured examples (not a
strict 5-minute grid like Growatt's day chart) — would need per-point
`dataTimestamp` deltas rather than assuming a fixed `intervalMinutes` if
implemented.

#### Inverter Month / Year

```
POST /v1/api/inverterMonth
Body: { "id": "<inverterId>", "money": "USD", "month": "2026-07" }

POST /v1/api/inverterYear
Body: { "id": "<inverterId>", "money": "USD", "year": "2026" }
```

Daily (month) / monthly (year) energy totals — candidate source for
`fetchHistorySummary` without N separate day calls, unlike ShineMonitor/Growatt
which synthesize summaries from per-day series.

#### Station equivalents

`stationDay` / `stationMonth` / `stationYear` mirror the inverter endpoints
at station granularity (useful when a station has multiple inverters to sum).

### 4.4 Alarms

```
POST /v1/api/alarmList
Body: { "stationId": "<stationId>", "pageNo": 1, "pageSize": 20 }
```

Fault/warning history — no equivalent in ShineMonitor/Growatt adapters today;
out of scope for the normalized contract (PLAN.md §3) but noted for
completeness.

---

## 5. Rate Limits

Per the official spec: **calling frequency is limited to 3 requests per 5
seconds, per source IP, across all endpoints combined.** For a single-tenant
Worker isolate polling one or two systems every 60 s (current architecture),
this is not a practical constraint — each poll cycle needs one `inverterDetail`
call per system. It **would** matter if `fetchHistorySummary` fanned out N
day-endpoint calls in a tight loop (same caution as ShineMonitor/Growatt
summary loops, PLAN.md §6) or if many systems shared one Worker isolate/IP.

---

## 6. Comparison With ShineMonitor / Growatt

| Feature | ShineMonitor | Growatt | Solis (this spike) |
|---------|-------------|---------|---------------------|
| API status | Reverse-engineered, undocumented | Reverse-engineered, undocumented | **Officially documented** (published spec) |
| Auth | SHA-1 signed GET, user/password | Cookie session, user/password | **HMAC-SHA1 signed POST, API key/secret** |
| Onboarding | User enters portal user/password directly | Same | **Manual key-activation approval required first** |
| Session | Token, 5 min TTL | `JSESSIONID`, 4 min TTL | **None — every request signed fresh** |
| CORS | Open (`*`) | None | None expected (not applicable — B2B API) |
| Battery SOC | API when valid, else voltage-estimated | Reported directly | Reported directly (`batteryCapacitySoc`) |
| History | Paginated day query | Day chart + line chart + bat chart | Day/Month/Year per inverter *and* per station |
| Rate limit | Not documented / not hit in practice | Not documented / not hit in practice | **Documented: 3 req / 5 s per IP** |

---

## 7. Spike Conclusion — Adapter Viability

**Technically viable.** The signing scheme is well-specified, endpoints map
cleanly onto the existing `discover()` / `fetchData()` / `fetchHistory()` /
`fetchHistorySummary()` adapter interface (ADAPTER_GUIDE.md §3), and — unlike
Growatt — there's an official spec to code against instead of guessing from
captured traffic.

**Two things justify waiting rather than building now (per PLAN.md §12,
Phase 5 = "TBD by user need"):**

1. **Onboarding UX regression.** Every other adapter's `discover()` takes a
   portal username + password typed into the existing "Add system" modal and
   works immediately. Solis requires the *account owner* to first complete a
   manual, asynchronous key-activation step outside the dashboard (support
   ticket + captcha + email code + Solis approval) before any credentials
   exist to enter. The setup flow would need a "waiting on Solis approval"
   state that doesn't exist today.
2. **Field-shape uncertainty without a live account.** Several fields
   (battery power sign/variant, units on `pac`/PV string power) differ across
   spec versions and community reports. Building `fetchData()`'s normalization
   (PLAN.md §3.1 sign conventions) against unverified field names risks
   shipping silently-wrong battery charge/discharge direction — exactly the
   kind of bug the existing adapters avoid by testing against fixtures from
   real captured responses (ADAPTER_GUIDE.md §10.5).

**Recommendation:** revisit when a user with an active SolisCloud API key
volunteers to test against it — at that point, capture real
`inverterDetail`/`inverterDay` responses as fixtures (redacted) and follow the
standard adapter checklist (ADAPTER_GUIDE.md §11) rather than building blind
from documentation.

---

## 8. Sources

- SolisCloud Platform API Document v2.0 / v2.0.2 (Ginlong Technologies,
  hosted at `oss.soliscloud.com/templet/`)
- `doc.soliscloud.com` — SolisCloud Platform API Document (HTML mirror)
- Solis North America support KB — "SolisCloud API Guide", "Request API
  Access - SolisCloud"
- `github.com/hultenvp/soliscloud_api` — Python client implementing the
  spec's endpoint set (station/inverter/collector/EPM list+detail+history)
- `github.com/hultenvp/solis-sensor` discussion #71 ("BETA: SolisCloud
  support") — field-name notes and known data-quality issues from real users
