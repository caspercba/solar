# ShineMonitor public web API reference

This documents the **browser-facing JSON API** used by [www.shinemonitor.com](https://www.shinemonitor.com/) (Eybond / SmartClient ecosystem). It was reverse-engineered from network traffic and the site’s own JavaScript (`js/loginIndex.js`, `js/libhttp.js`).

**Base URL for all actions below:** `https://web.shinemonitor.com/public/`

**Method:** `GET` (query string only; no JSON body).

---

## Response envelope

Almost all endpoints return JSON with this shape:

```json
{
  "err": 0,
  "desc": "ERR_NONE",
  "dat": {}
}
```

- **`err`**: `0` means success. Non-zero values indicate errors (the portal maps them to messages; a full code list is not published here).
- **`desc`**: Short string, often `ERR_NONE`.
- **`dat`**: Payload; type depends on `action`.

Some dashboard calls are loaded as **JSONP** (`callback=jQuery…`); the HTTP body is then a JavaScript snippet wrapping the same JSON object. For your own clients, call without `callback` and use `Accept: application/json` where the server allows it—plain JSON is returned for many actions.

---

## Related hosts (same product)

| Host | Role |
|------|------|
| `https://www.shinemonitor.com/` | Web UI (HTML/JS) |
| `https://web.shinemonitor.com/public/` | **This API** (signed GET) |
| `https://ws.shinemonitor.com/` | Legacy/alternate **WebSocket** API (`ws?sign=…`) used by some `http_normal_oper` code paths in `libhttp.js` |
| `https://hmi.eybond.com/`, `https://aam.eybond.com/`, … | Domain checks, app config, tasks (supporting calls from the login page) |

This document focuses on **`web.shinemonitor.com/public/`**.

---

## 1. Unauthenticated / bootstrap

### 1.1 `queryDomainListNotLogin`

Used before login to resolve domain-specific settings for the web client.

**Example query (from captured traffic; `sign`/`salt` are time-bound):**

```
GET /public/?sign=<hex>&salt=<ms>&action=queryDomainListNotLogin&source=1&_app_client_=web&_app_id_=www.shinemonitor.com&_app_version_=1.0.6.3&i18n=en_US
```

Signing for this path was not fully traced in discovery; the portal computes it on load. For automation, **use `action=auth` instead** (below) to obtain a session.

---

## 2. Authentication (`action=auth`)

### 2.1 Password hashing

```text
pwd_sha1 = lowercase_hex( SHA1( UTF-8(password) ) )
```

Example: SHA1 of `"hello"` → `aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d` (40 hex chars).

### 2.2 `company-key` (www.shinemonitor.com)

The English login page uses a fixed key embedded in `loginIndex.js`:

```text
company-key=bnrl_frRFjEz8Mkn
```

Other white-label domains may use a different key.

### 2.3 Username encoding

Build the `action` fragment (used **inside** the sign string) as:

```text
&action=auth&usr=<ENCODED_USR>&company-key=bnrl_frRFjEz8Mkn
```

`<ENCODED_USR>` is URL-encoded per the site rules: `encodeURIComponent(username)`, then replace `+` → `%2B` and `'` → `%27`.

### 2.4 Auth signature

```text
salt = current_time_millis()   // integer, e.g. 1775336644976
action = "&action=auth&usr=..." // as above, literal & at start
sign = lowercase_hex( SHA1( string(salt) + pwd_sha1 + action ) )
```

### 2.5 Auth request URL

```text
GET https://web.shinemonitor.com/public/?sign=<sign>&salt=<salt>&action=auth&usr=<ENCODED_USR>&company-key=bnrl_frRFjEz8Mkn
```

Note: `sign` and `salt` are query parameters; the `action` string after `salt` must match the string hashed (the server reconstructs or parses the same parameters).

### 2.6 Example auth success (`dat`)

```json
{
  "err": 0,
  "desc": "ERR_NONE",
  "dat": {
    "secret": "15dac2c1982c31cd7fa35095361df145ad1d21bd",
    "expire": 432000,
    "token": "2a380ad82024b7bb865aa70d327eeda75959481cb717c462f867db66b51f47c4",
    "role": 0,
    "usr": "example_user",
    "uid": 53002
  }
}
```

Store **`token`**, **`secret`**, and **`uid`** for subsequent calls. **`expire`** is session lifetime hint (seconds, as used by the UI).

---

## 3. Authenticated requests

After auth, every public API call uses:

| Query param | Meaning |
|-------------|---------|
| `sign` | HMAC-like SHA1 (see below) |
| `salt` | Milliseconds timestamp (new per request) |
| `token` | From `dat.token` |
| … | Action-specific parameters |
| `i18n` | Locale, e.g. `en_US` |
| `lang` | Same as `i18n` in practice |

The portal’s `http_async_request_public` in `libhttp.js` **appends** `&i18n=…&lang=…` to the action string before signing.

### 3.1 Action string for signing

Let `action_core` start with `&action=…` and include all parameters **except** `sign`, `salt`, `token`.

Then:

```text
action = action_core + "&i18n=" + lang + "&lang=" + lang
```

Apply the same encoding the site uses when hashing and when placing parameters in the URL:

```text
encoded = action
  .replace("#", "%23")
  .replace("'", "%27")
  .replace(" ", "%20")
```

### 3.2 Authenticated signature

```text
sign = lowercase_hex( SHA1( string(salt) + secret + token + encoded ) )
```

Where `secret` is from `dat.secret`.

### 3.3 Authenticated request URL

```text
GET https://web.shinemonitor.com/public/?sign=<sign>&salt=<salt>&token=<token><encoded>
```

`<encoded>` is the full `action` string after encoding (starts with `&action=…`).

---

## 4. Endpoint catalog (`web.shinemonitor.com/public/`)

The following `action` values were observed in browser traffic or in portal scripts. Parameters are representative; some plants omit optional fields.

### 4.1 `queryPlantsInfo`

**`action_core`:** `&action=queryPlantsInfo`

**Example response `dat`:**

```json
{
  "total": 0,
  "page": 0,
  "pagesize": 0,
  "info": [
    {
      "uid": 53002,
      "usr": "example_user",
      "pid": 77218,
      "pname": "Rio del medio",
      "status": 0
    }
  ]
}
```

- **`pid`**: Plant id — use as `plantid` in other calls.

---

### 4.2 `queryPlantInfo`

**`action_core`:** `&action=queryPlantInfo&plantid=<pid>`

**Example response `dat`:**

```json
{
  "pid": 77218,
  "uid": 53002,
  "name": "Rio del medio",
  "status": 0,
  "energyOffset": 0.0,
  "address": {
    "country": "Argentina",
    "province": "3",
    "city": "3",
    "county": "3",
    "address": "Rio del Medio",
    "lon": "-64.226387",
    "lat": "-31.449984",
    "timezone": -10800
  },
  "profit": {
    "unitProfit": "9.0000",
    "currency": "$",
    "coal": "0.400",
    "co2": "0.990",
    "so2": "0.030",
    "soldProfit": 0.0,
    "selfProfit": 0.0,
    "purchProfit": 0.0,
    "consProfit": 0.0,
    "feedProfit": 0.0
  },
  "nominalPower": "5.0000",
  "energyYearEstimate": "0.0000",
  "designCompany": "Truchos",
  "picBig": "https://img.shinemonitor.com/img/2023/12/19/…jpg",
  "install": "2019-05-30 00:00:00",
  "gts": "2019-05-30 15:53:31",
  "flag": true
}
```

- **`nominalPower`**: String kW — useful as nameplate max for “% of solar capacity”.

---

### 4.3 `queryPlantDeviceStatus`

**`action_core`:** `&action=queryPlantDeviceStatus&plantid=<pid>`

**Example response `dat`:**

```json
{
  "status": 0,
  "collector": [
    {
      "pn": "B1419120275203",
      "alias": "Qi-fi RTU",
      "status": 0,
      "device": [
        {
          "devcode": 697,
          "devaddr": 4,
          "sn": "FFFFFFFF",
          "status": 0,
          "comStatus": 1
        }
      ]
    }
  ]
}
```

Use **`pn`**, **`devcode`**, **`sn`**, **`devaddr`** when calling chart APIs that need per-device identifiers.

---

### 4.4 `queryPlantCurrentData`

**`action_core`:** `&action=queryPlantCurrentData&plantid=<pid>&par=<CSV_KEYS>`

**`par`**: Comma-separated list of metric keys (no spaces). Observed keys on the plant overview include:

| Key | Example meaning |
|-----|-----------------|
| `ENERGY_TODAY` | Today’s energy (kWh string) |
| `ENERGY_MONTH` | Month energy |
| `ENERGY_YEAR` | Year energy |
| `ENERGY_TOTAL` | Lifetime energy |
| `ENERGY_PROCEEDS` | Revenue string (currency in value) |
| `ENERGY_CO2` | CO₂ equivalent |
| `ENERGY_COAL` | Coal saved |
| `ENERGY_SO2` | SO₂ |
| `CURRENT_TEMP` | Temperature |
| `CURRENT_RADIANT` | Irradiance |
| `BATTERY_SOC` | State of charge (%); **`-1` if unavailable** |
| `CURRENT_POWER` | Instantaneous plant output **kW** (string) |

**Example response `dat`:**

```json
[
  { "key": "ENERGY_TODAY", "val": "1.9000" },
  { "key": "ENERGY_TOTAL", "val": "15585.7000" },
  { "key": "CURRENT_POWER", "val": "0.1370" },
  { "key": "BATTERY_SOC", "val": -1 },
  { "key": "CURRENT_TEMP", "val": "0.0" },
  { "key": "CURRENT_RADIANT", "val": "0.0" }
]
```

The UI may request JSONP with extra `callback` and `_` query params; signing still uses the same `action` string the client built (including `i18n`/`lang`).

---

### 4.5 `queryPlantActiveOuputPowerOneDay`

**`action_core`:** `&action=queryPlantActiveOuputPowerOneDay&plantid=<pid>&date=YYYY-MM-DD`

Returns roughly **5-minute** samples of active output power for that local plant day.

**Example response `dat`:**

```json
{
  "outputPower": [
    { "val": "0.0000", "ts": "2026-04-04 00:00:00" },
    { "val": "0.7810", "ts": "2026-04-04 16:00:00" }
  ],
  "activePowerSwitch": true
}
```

- **`val`**: String kW.

---

### 4.6 `queryTodayDevicePvCharts`

**`action_core`:**  
`&action=queryTodayDevicePvCharts&plantid=<pid>&pns=<pn_csv>&sort=&devcodes=<code_csv>&sns=<sn_csv>&devaddrs=<addr_csv>`

Example from traffic: one device → `pns=B1419120275203`, `devcodes=697`, `sns=FFFFFFFF`, `devaddrs=4`. Multiple devices use comma-separated lists (URL-encoded commas as `%2C` in the signed string as needed).

**Purpose:** Per-string PV chart data for the current day (structure varies by firmware; inspect `dat` for your plant).

---

### 4.7 `webQueryPlantsWarning`

**`action_core`:**  
`&action=webQueryPlantsWarning&sdate=YYYY-MM-DD%20HH:MM:SS&edate=YYYY-MM-DD%20HH:MM:SS`

Optional pagination variant includes `&handle=false&page=0&pagesize=8`.

**Purpose:** Plant warning/alarm list for the date window.

---

### 4.8 `queryPlantCamera`

**`action_core`:** `&action=queryPlantCamera&plantid=<pid>`

**Purpose:** Camera / live view configuration for the plant (if any).

---

### 4.9 `queryPlantElectricmeter`

**`action_core`:** `&action=queryPlantElectricmeter&pid=<pid>`

Note parameter name **`pid`** (not `plantid`) for this action.

**Purpose:** Metering data association for the plant.

---

### 4.10 `queryDeviceFields`

**`action_core`:** `&action=queryDeviceFields&pn=<pn>&devcode=<devcode>&sn=<sn>&devaddr=<devaddr>`

Returns the list of data fields the device can report, with internal position codes and display flags.

**Example response `dat`:**

```json
[
  { "name": "Battery Voltage", "pos": "0,4,4", "flag": true },
  { "id": "pv_voltage", "name": "PV Voltage", "pos": "0,7,4", "flag": true },
  { "name": "Inverter Voltage", "pos": "0,4,5", "flag": true },
  { "name": "Batt Current", "pos": "0,4,64", "flag": true },
  { "id": "charger_current", "name": "Charger Current", "pos": "0,7,6", "flag": true },
  { "id": "output_power", "name": "Charger Power", "pos": "0,7,7", "flag": true },
  { "id": "pload", "name": "PLoad", "pos": "0,4,14", "flag": true },
  { "id": "pgrid", "name": "PGrid", "pos": "0,4,13", "flag": false },
  { "id": "status", "name": "work state", "pos": "0,4,0", "flag": false },
  { "id": "rating_power", "name": "rated power", "pos": "0,4,2", "flag": true },
  { "name": "Grid Voltage", "pos": "0,4,6", "flag": false },
  { "name": "PInverter", "pos": "0,4,12", "flag": true },
  { "id": "accumulated_load_power", "name": "Accumulated Load Power", "pos": "0,4,48", "flag": true },
  { "name": "Accumulated Self_Use Power", "pos": "0,4,49", "flag": true },
  { "id": "energy_total", "name": "Accumulated PV Power", "pos": "0,7,16", "flag": true }
]
```

---

### 4.11 `queryDeviceViewField`

**`action_core`:** `&action=queryDeviceViewField&pn=<pn>&devcode=<devcode>&sn=<sn>&devaddr=<devaddr>`

Returns the same fields with units and position codes (used by the UI to label columns).

**Example response `dat`:**

```json
{
  "title": [
    { "title": "Battery Voltage", "unit": "V", "position": 132 },
    { "title": "PV Voltage", "unit": "V", "position": 332 },
    { "title": "Inverter Voltage", "unit": "V", "position": 134 },
    { "title": "Batt Current", "unit": "A", "position": 270 },
    { "title": "Charger Current", "unit": "A", "position": 336 },
    { "title": "Charger Power", "unit": "W", "position": 338 },
    { "title": "PLoad", "unit": "W", "position": 152 },
    { "title": "rated power", "unit": "W", "position": 128 },
    { "title": "PInverter", "unit": "W", "position": 148 },
    { "title": "Accumulated Load Power", "unit": "kWh", "position": 228 },
    { "title": "Accumulated Self_Use Power", "unit": "kWh", "position": 232 },
    { "title": "Accumulated PV Power", "unit": "kWh", "position": 356 }
  ]
}
```

---

### 4.12 `queryDeviceDataOneDayPaging` (key endpoint for dashboard)

**`action_core`:**  
`&action=queryDeviceDataOneDayPaging&pn=<pn>&devcode=<devcode>&sn=<sn>&devaddr=<devaddr>&date=YYYY-MM-DD&page=<page>&pagesize=<pagesize>`

Returns paginated device data for a day. **Page 0 is the most recent reading** (descending order).

**Example response `dat`:**

```json
{
  "total": 228,
  "page": 0,
  "pagesize": 1,
  "title": [
    { "title": "id", "isDisplay": 1 },
    { "title": "Timestamp", "isDisplay": 1 },
    { "title": "Battery Voltage", "unit": "V", "isDisplay": 1 },
    { "title": "PV Voltage", "unit": "V", "isDisplay": 1 },
    { "title": "Inverter Voltage", "unit": "V", "isDisplay": 1 },
    { "title": "Batt Current", "unit": "A", "isDisplay": 1 },
    { "title": "Charger Current", "unit": "A", "isDisplay": 1 },
    { "title": "Charger Power", "unit": "W", "isDisplay": 1 },
    { "title": "PLoad", "unit": "W", "isDisplay": 1 },
    { "title": "rated power", "unit": "W", "isDisplay": 1 },
    { "title": "PInverter", "unit": "W", "isDisplay": 1 },
    { "title": "Accumulated Load Power", "unit": "kWh", "isDisplay": 1 },
    { "title": "Accumulated Self_Use Power", "unit": "kWh", "isDisplay": 1 },
    { "title": "Accumulated PV Power", "unit": "kWh", "isDisplay": 1 }
  ],
  "row": [
    {
      "realtime": true,
      "field": [
        "0b61729c13d48bb35fa63f88eacce22a",
        "2026-04-04 18:19:48",
        "51.6",
        "245.8",
        "221.1",
        "-62",
        "0.3",
        "110",
        "283",
        "5200",
        "-3267",
        "10323",
        "11300",
        "15585.80"
      ]
    }
  ]
}
```

**Field index map** (for the `field` array — after enabling PGrid, work state, Grid Voltage via `editDeviceFields`):

| Index | Field | Unit | Notes |
|-------|-------|------|-------|
| 0 | id | — | Internal row id |
| 1 | Timestamp | — | `YYYY-MM-DD HH:MM:SS` |
| 2 | **Battery Voltage** | V | **Use for battery panel** |
| 3 | PV Voltage | V | Panel string voltage |
| 4 | Inverter Voltage | V | AC output voltage |
| 5 | Batt Current | A | Negative = charging, positive = discharging |
| 6 | Charger Current | A | Solar charger current |
| 7 | **Charger Power** | W | **Solar input power — use for solar panel** |
| 8 | **PLoad** | W | **Load power — use for load panel** |
| 9 | **PGrid** | W | **Generator/grid power — use for generator panel** |
| 10 | work state | — | Inverter mode string (e.g. `"Grid-Tie"`) |
| 11 | rated power | W | Inverter rated power (5200 W) — **use for load % max** |
| 12 | Grid Voltage | V | Generator/grid voltage |
| 13 | PInverter | W | Inverter active power |
| 14 | Accumulated Load Power | kWh | Lifetime load energy |
| 15 | Accumulated Self_Use Power | kWh | — |
| 16 | Accumulated PV Power | kWh | Lifetime PV energy |

> **Note:** The dashboard parses fields by title name (not index) so it adapts if fields are added or reordered. The indices above reflect the current configuration after enabling PGrid, work state, and Grid Voltage.

---

### 4.13 `queryDeviceRealLastData`

**`action_core`:** `&action=queryDeviceRealLastData&devaddr=<devaddr>&pn=<pn>&devcode=<devcode>&sn=<sn>&date=YYYY-MM-DD`

Should return the most recent data row. In practice, this sometimes returns `dat: []` — prefer `queryDeviceDataOneDayPaging` with `page=0&pagesize=1`.

---

### 4.14 `editDeviceFields`

**`action_core`:**  
`&action=editDeviceFields&devaddr=<devaddr>&pn=<pn>&devcode=<devcode>&sn=<sn>&name=<field_name>&visable=<true|false>&position=<pos>`

Enables or disables a data field so it appears (or is hidden) in `queryDeviceDataOneDayPaging` results.

| Parameter | Description | Example |
|-----------|-------------|---------|
| `name` | Field name (URL-encoded) | `PGrid`, `Grid%20Voltage`, `work%20state` |
| `visable` | `true` to show, `false` to hide | `true` |
| `position` | The `pos` value from `queryDeviceFields` | `0,4,13` |

**Example:** Enable the PGrid field:

```
&action=editDeviceFields&devaddr=4&pn=B1419120275203&devcode=697&sn=FFFFFFFF&name=PGrid&visable=true&position=0,4,13
```

Returns `{"err":0,"desc":"ERR_NONE"}` on success. The change is persistent — once enabled, the field appears in all subsequent data queries.

**Fields we enabled for the dashboard:**

| Field | Position | Purpose |
|-------|----------|---------|
| PGrid | `0,4,13` | Generator/grid power (W) |
| Grid Voltage | `0,4,6` | Generator/grid voltage (V) |
| work state | `0,4,0` | Inverter operating mode (e.g. "Grid-Tie") |

After enabling these, the `queryDeviceDataOneDayPaging` title/field arrays grow to include the new columns (order determined by position).

---

### 4.15 `queryDeviceCtrlField`

**`action_core`:** `&action=queryDeviceCtrlField&pn=<pn>&devcode=<devcode>&sn=<sn>&devaddr=<devaddr>`

Returns the list of **control / settings items** the device exposes for reading and (sometimes) writing. This is the official ShineMonitor API — documented at [api.shinemonitor.com](https://api.shinemonitor.com/en/chapter5/queryDeviceCtrlField.html).

**Example response `dat`:**

```json
{
  "field": [
    {
      "id": "battery_low_voltage",
      "name": "battery low voltage",
      "unit": "V"
    },
    {
      "id": "battery_high_voltage",
      "name": "battery high voltage",
      "unit": "V"
    },
    {
      "id": "energy_use_mode",
      "name": "energy use mode",
      "item": [
        { "key": "0", "val": "PL" },
        { "key": "1", "val": "FL" },
        { "key": "2", "val": "FS" },
        { "key": "3", "val": "UPS" },
        { "key": "4", "val": "PO" }
      ]
    }
  ]
}
```

Fields with `item` arrays are enumerations (read the `val` from `queryDeviceCtrlValue`). Fields with `unit` are numeric settings. Some have a `hint` property with format guidance (e.g. `"23:59"` for time fields).

**Full field list for our inverter (devcode 697):**

| `id` | `name` | `unit` | Type |
|------|--------|--------|------|
| `shutdown_work` | Ongrid Switch | — | Enum: Deactivate / Enable |
| `shutdown` | Offgrid Switch | — | Enum: Deactivate / Enable |
| `inverter_discharger_to_grid_enable` | inverter discharger to grid enable | — | Enum: ON / OFF |
| `inverter_offline_working_enable` | inverter offline working enable | — | Enum: OFF / ON |
| `inverter_output_voltage_set` | inverter output voltage Set | V | Numeric |
| `inverter_output_frequency_set` | inverter output frequency Set | Hz | Numeric |
| `grid_protect_standard` | grid protect standard | — | Enum: VDE4105 / UPS / home / GEN |
| `inverter_max_discharger_current` | inverter max discharger current | A | Numeric |
| `battery_low_voltage` | battery low voltage | V | Numeric |
| `battery_high_voltage` | battery high voltage | V | Numeric |
| `max_combine_charger_current` | max combine charger current | A | Numeric |
| `solaruse_aim` | solaruse_aim | — | Enum: LBU / BLU |
| `energy_use_mode` | energy use mode | — | Enum: PL / FL / FS / UPS / PO |
| `inverter_search_mode_enable` | inverter search mode enable | — | Enum: OFF / ON |
| `charger_source_priority` | charger source priority | — | Enum: Solar first / Solar and Utility / Only Solar |
| `sn` | serial number | — | Numeric |
| `buf_voltage_calibration_coefficient` | bus voltage calibration coefficient | — | Calibration |
| `battery_voltage_calibration_coefficient` | battery voltage calibration coefficient | — | Calibration |
| `grid_voltage_calibration_coefficient` | grid voltage calibration coefficient | — | Calibration |
| `grid_current_calibration_coefficient` | grid current calibration coefficient | — | Calibration |
| `load_current_calibration_coefficient` | load current calibration coefficient | — | Calibration |
| `inverter_voltage_calibration_coefficient` | inverter voltage calibration coefficient | — | Calibration |
| `inverter_current_calibration_coefficient` | inverter current calibration coefficient | — | Calibration |
| `control_current_calibration_coefficient` | control current calibration coefficient | — | Calibration |

---

### 4.16 `queryDeviceCtrlValue`

**`action_core`:** `&action=queryDeviceCtrlValue&pn=<pn>&devcode=<devcode>&sn=<sn>&devaddr=<devaddr>&id=<field_id>`

Reads the current value of a single control field (by `id` from `queryDeviceCtrlField`).

**Example response `dat`:**

```json
{
  "id": "battery_low_voltage",
  "name": "battery low voltage",
  "val": "40.5"
}
```

**All control values for our inverter (captured 2026-04-04):**

| `id` | Value | Unit | Notes |
|------|-------|------|-------|
| `shutdown_work` | Enable | — | On-grid switch |
| `shutdown` | Enable | — | Off-grid switch |
| `inverter_discharger_to_grid_enable` | ON | — | Feed-in enabled |
| `inverter_offline_working_enable` | ON | — | Off-grid capable |
| `inverter_output_voltage_set` | 230.0 | V | AC output target |
| `inverter_output_frequency_set` | 50.00 | Hz | AC frequency |
| `grid_protect_standard` | GEN | — | Grid input configured as **generator** |
| `inverter_max_discharger_current` | 17.4 | A | Max battery discharge rate |
| `battery_low_voltage` | **40.5** | V | **Low voltage alarm threshold** (not discharge cutoff) |
| `battery_high_voltage` | **60.0** | V | **High voltage alarm threshold** (not charge voltage) |
| `max_combine_charger_current` | 80.0 | A | Max combined charge current |
| `solaruse_aim` | BLU | — | Battery → Load → Utility priority |
| `energy_use_mode` | FS | — | "Feed Solar" mode |
| `inverter_search_mode_enable` | OFF | — | |
| `charger_source_priority` | -- | — | Not set / auto |
| `sn` | 4294967295 | — | 0xFFFFFFFF — unprogrammed |
| Calibration coefficients | 65535 | — | Factory defaults (0xFFFF) |

---

### 4.17 Battery voltage settings — what the API does and does NOT expose

The `battery_low_voltage` (40.5V) and `battery_high_voltage` (60.0V) from the control API are **alarm thresholds**, not the inverter's charge profile voltages. The actual charge profile settings are programmed into the inverter but **not accessible** through the ShineMonitor web API:

| Setting | Approximate value | API available? |
|---------|-------------------|----------------|
| Bulk / absorption charge voltage | ~56 V | **No** |
| Float charge voltage | ~53.5 V | **No** |
| Low voltage discharge cutoff | ~42 V | **No** |
| Low voltage alarm | 40.5 V | Yes (`battery_low_voltage`) |
| High voltage alarm | 60.0 V | Yes (`battery_high_voltage`) |

For SOC estimation, the dashboard uses hardcoded defaults based on the actual inverter programming:
- **0%** = 42 V (low cutoff — inverter stops discharging)
- **100%** = 56 V (bulk/absorption — fully charged)

These can be queried from Voltronic/Axpert inverters via raw serial commands (`QPIRI`) through the ShineMonitor debug interface, but there is no web API endpoint for them.

---

### 4.18 `operationsQueryDeviceParams`

**`action_core`:** `&action=operationsQueryDeviceParams&pn=<pn>&devcode=<devcode>&sn=<sn>&devaddr=<devaddr>`

Returns device parameters available for use in **automation rules** (Plant Operation page). Each parameter includes a JSON-encoded key describing its data position.

**Example response `dat`:**

```json
{
  "option": [
    {
      "key": "{\"area\":\"MIXED\",\"segment\":4,\"indx\":4}",
      "param": "Battery Voltage"
    },
    {
      "key": "{\"area\":\"MIXED\",\"segment\":4,\"indx\":14}",
      "param": "PLoad"
    }
  ]
}
```

---

### 4.19 Other actions referenced in portal JS

These go through the same signing rules when called via `http_async_request_public`:

| Action | Typical use (from code / UI) |
|--------|------------------------------|
| `queryPlantInfo` | Already documented |
| `queryPlantsInfo` | Already documented |
| `editPlant` | Edit plant metadata (from `plant.html`) |
| `getWeatherByPlant` | Weather widget for plant |

The **WebSocket** API on `https://ws.shinemonitor.com/` uses different paths (e.g. `plantCurrentData`, `plantDeviceStatus` with `par` like `ENERGY_TODAY,CURRENT_POWER`) and signs with `salt + pwd_sha1 + action` or `salt + secret + token + action` depending on the function—see `libhttp.js` if you need that transport.

---

## 5. HTTP headers (recommended)

For server-style clients:

```http
Accept: application/json, text/javascript, */*; q=0.01
User-Agent: <your app name>
```

The browser sends `Origin: https://www.shinemonitor.com` and `Referer` from that origin; the API responded with `access-control-allow-origin: *` in captured responses, but behavior may change.

---

## 6. Stability and terms

This API is **undocumented for third parties**. Names, parameters, and signing may change without notice. Use for **personal automation** only and comply with ShineMonitor / Eybond terms of use.

---

## 7. Reference implementation

See `fetch_plant_json.py` in this folder for working **auth + signed GET** in Python (stdlib only).
