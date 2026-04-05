# Growatt API Reference

> Reverse-engineered from `https://mqtt.growatt.com/` (ShineServer 3.6.9.0).
> Discovered April 2026.

## System Details

| Item | Value |
|------|-------|
| Plant ID | `10489936` |
| Plant Name | Casita del rio |
| Device SN | `JQK8NYB00S` |
| Device Model | SPF 3500 ES |
| Device Type | `3` (storage) |
| Data Logger SN | `DDD0E3G05N` |
| Data Logger Type | ShineWIFI-S |
| Nominal PV Power | 2080 W |
| Rated Inverter Power | 3500 W |
| Location | Comuna Los Reartes, Córdoba, Argentina |
| Timezone | UTC-3 |

---

## Authentication

### Login

```
POST https://mqtt.growatt.com/login
Content-Type: application/x-www-form-urlencoded
```

**Body:**

```
account=riodelmedio&password=rio2909&validateCode=&isReadPact=0&lang=en
```

**Response:**

```json
{"result": 1}
```

**Cookies set (important ones):**

| Cookie | Purpose | Expiry |
|--------|---------|--------|
| `JSESSIONID` | Session token | Session (HttpOnly) |
| `selectedPlantId` | Active plant | 30 min |
| `plantSize` | Number of plants | 2 min |
| `onePlantId` | Single-plant shortcut | 2 min |
| `onePlantType` | Plant type | 2 min |
| `SERVERID` | Sticky session | Session |

**Auth mechanism:** Cookie-based session. All subsequent requests must include the `JSESSIONID` cookie. Password is sent in **plaintext** (over HTTPS). No token/salt hashing like ShineMonitor.

### Session Expiry

Sessions expire after a period of inactivity (observed ~5-10 minutes). When expired, the server returns an HTML 404 page with "Dear user, you have not login to the system".

---

## CORS

**There are NO `access-control-allow-origin` headers** on any Growatt API response. This means direct browser-side API calls from a different domain (e.g. GitHub Pages) will be **blocked by CORS**.

A server-side proxy is required for any dashboard that needs to fetch data from Growatt.

---

## Endpoints

All endpoints use:
- Method: `POST` (unless noted)
- Content-Type: `application/x-www-form-urlencoded`
- Auth: `JSESSIONID` cookie
- Base URL: `https://mqtt.growatt.com`

Responses are JSON with `{"result": 1, "obj": {...}}` structure.

---

### 1. Plant / Device Discovery

#### Get Plant List Title

```
POST /index/getPlantListTitle
```

Returns list of plants for the logged-in user.

#### Get Devices by Plant (List View)

```
POST /panel/getDevicesByPlantList
Body: currPage=1&plantId=10489936
```

**Response:**

```json
{
  "result": 1,
  "obj": {
    "currPage": 1,
    "pages": 1,
    "pageSize": 4,
    "count": 1,
    "datas": [
      {
        "deviceType": "3",
        "ptoStatus": "0",
        "timeServer": "2026-04-06 00:06:16",
        "accountName": "riodelmedio",
        "timezone": "-3.0",
        "plantId": "10489936",
        "deviceTypeName": "storage",
        "bdcNum": "0",
        "nominalPower": "3500.0",
        "bdcStatus": "0",
        "eToday": "0.9",
        "eMonth": "9.0",
        "datalogTypeTest": "ShineWIFI-S",
        "eTotal": "693.7",
        "pac": "225.0",
        "datalogSn": "DDD0E3G05N",
        "alias": "Batería litio",
        "deviceModel": "SPF 3500 ES",
        "sn": "JQK8NYB00S",
        "plantName": "Casita del rio",
        "status": "12",
        "lastUpdateTime": "2026-04-05 13:06:16"
      }
    ]
  }
}
```

#### Get Devices by Plant (Internal)

```
POST /panel/getDevicesByPlant?plantId=10489936
```

---

### 2. Plant Data

#### Get Plant Data

```
POST /panel/getPlantData?plantId=10489936
```

**Response:**

```json
{
  "result": 1,
  "obj": {
    "country": "Argentina",
    "accountName": "riodelmedio",
    "city": "Comuna Los Reartes",
    "timezone": "-3",
    "co2": "691.6",
    "creatDate": "2025-09-14",
    "fixedPowerPrice": "1.2",
    "id": "10489936",
    "lat": "-31.898",
    "lng": "-64.635",
    "plantType": "0",
    "nominalPower": "2080",
    "eTotal": "693.7",
    "plantName": "Casita del rio",
    "moneyUnit": "USD",
    "coal": "277.5",
    "tree": "38"
  }
}
```

---

### 3. Real-Time Status (Main Data Endpoint)

#### Get Storage Status Data

```
POST /panel/storage/getStorageStatusData?plantId=10489936
Body: storageSn=JQK8NYB00S
```

**Response:**

```json
{
  "result": 1,
  "obj": {
    "vPv1": "162.1",
    "vPv2": "0",
    "iPv1": "0.8",
    "iPv2": "0",
    "iTotal": "0.8",
    "ppv1": "133",
    "ppv2": "0",
    "panelPower": "133",
    "vBat": "53",
    "batPower": "0",
    "capacity": "29",
    "vAcInput": "0",
    "fAcInput": "0",
    "vAcOutput": "220",
    "fAcOutput": "50",
    "loadPower": "109",
    "loadPrecent": "3.1",
    "gridPower": "0",
    "rateVA": "184",
    "deviceType": "3",
    "invStatus": "-10",
    "status": "12"
  }
}
```

**Key fields:**

| Field | Description | Unit |
|-------|-------------|------|
| `vPv1` / `vPv2` | PV string voltages | V |
| `iPv1` / `iPv2` | PV string currents | A |
| `ppv1` / `ppv2` | PV string power | W |
| `panelPower` | Total PV power | W |
| `vBat` | Battery voltage | V |
| `batPower` | Battery power (+ discharge, - charge) | W |
| `capacity` | Battery SOC | % |
| `vAcInput` | Grid/Gen input voltage | V |
| `fAcInput` | Grid/Gen input frequency | Hz |
| `vAcOutput` | Inverter output voltage | V |
| `fAcOutput` | Inverter output frequency | Hz |
| `loadPower` | Load consumption power | W |
| `loadPrecent` | Load as % of rated capacity | % |
| `gridPower` | Grid import power | W |
| `rateVA` | Rated VA (apparent power) | VA |
| `status` | Device status code (see table below) | - |
| `invStatus` | Inverter connection status | - |

#### Device Status Codes

| Code | Meaning |
|------|---------|
| -1 | Offline |
| 0 | Standby |
| 1 | PV&Grid Supporting Loads |
| 2 | Battery Discharging |
| 3 | Fault |
| 4 | Flash |
| 5 | PV Charging |
| 6 | Grid Charging |
| 7 | PV&Grid Charging |
| 8 | PV&Grid Charging + Grid Bypass |
| 9 | PV Charging + Grid Bypass |
| 10 | Grid Charging + Grid Bypass |
| 11 | Grid Bypass |
| 12 | PV Charging + Loads Supporting |
| 13 | PV Discharging |
| 14 | PV&Battery Discharging |
| 15 | Gen Charging |
| 16 | Gen Charging + Gen Bypass |
| 17 | PV&Gen Charging |
| 18 | PV&Gen Charging + Gen Bypass |
| 19 | PV Charging + Gen Bypass |
| 20 | Gen Bypass |
| 21 | PV Export to Grid |
| 22 | PV Export to Grid + Loads Supporting |
| 23 | PV Charging + Export to Grid |
| 24 | PV Charging + Export to Grid + Loads Supporting |
| 25 | Battery Export to Grid |
| 26 | Battery Export to Grid + Loads Supporting |
| 27 | Battery&PV Export to Grid |
| 28 | Battery&PV Export to Grid + Loads Supporting |

#### Inverter Status Codes

| Code | Meaning |
|------|---------|
| 1 | Online |
| 0 | Waiting |
| 3 | Fault |
| -1 | Offline |

---

### 4. Energy Totals

#### Get Storage Total Data

```
POST /panel/storage/getStorageTotalData?plantId=10489936
Body: storageSn=JQK8NYB00S
```

**Response:**

```json
{
  "result": 1,
  "obj": {
    "deviceType": "3",
    "useEnergyToday": "0.7",
    "useEnergyTotal": "333.7",
    "chargeToday": "0.9",
    "chargeTotal": "693.7",
    "eDischargeToday": "0.7",
    "eDischargeTotal": "209.5",
    "epvToday": "0.9",
    "epvTotal": "693.7",
    "eToGridToday": "0",
    "eToGridTotal": "0",
    "eToUserToday": "0",
    "eToUserTotal": "0"
  }
}
```

| Field | Description | Unit |
|-------|-------------|------|
| `epvToday` / `epvTotal` | Solar production | kWh |
| `chargeToday` / `chargeTotal` | Battery charge energy | kWh |
| `eDischargeToday` / `eDischargeTotal` | Battery discharge energy | kWh |
| `useEnergyToday` / `useEnergyTotal` | Load consumption energy | kWh |
| `eToGridToday` / `eToGridTotal` | Exported to grid | kWh |
| `eToUserToday` / `eToUserTotal` | Imported from grid | kWh |

---

### 5. Charts

#### Energy Day Chart

```
POST /panel/storage/getStorageEnergyDayChart
Body: plantId=10489936&storageSn=JQK8NYB00S&date=2026-04-05
```

Returns 288 data points (5-minute intervals) for:
- `ppv` — PV power (W)
- `userLoad` — Load power (W)
- `pacToGrid` — Export to grid (W)
- `pacToUser` — Import from grid (W)

Plus summary fields:
- `eChargeTotal`, `eDisCharge`, `eCharge`, `eAcCharge`, `eAcDisCharge`

#### Battery Chart (7-Day)

```
POST /panel/storage/getStorageBatChart
Body: plantId=10489936&storageSn=JQK8NYB00S
```

**Response:**

```json
{
  "result": 1,
  "obj": {
    "date": "2026-04-05",
    "cdsTitle": ["2026-03-30", "2026-03-31", "..."],
    "socChart": {
      "capacity": [41.0, 41.0, "...288 points..."]
    },
    "cdsData": {
      "cd_charge": [2.2, 2.2, 2.2, 2.4, 2.3, 1.2, 0.9],
      "cd_disCharge": [0.1, 0.0, 0.1, 0.1, 0.7, 1.5, 0.7]
    }
  }
}
```

- `socChart.capacity` — 288 SOC% values for today (5-min intervals)
- `cdsData.cd_charge` — Daily charge totals for past 7 days (kWh)
- `cdsData.cd_disCharge` — Daily discharge totals for past 7 days (kWh)

---

### 6. Weather

```
POST /index/getWeatherByPlantId?plantId=10489936
```

**Response (key fields):**

```json
{
  "result": 1,
  "obj": {
    "city": "Los reartes",
    "radiant": "--",
    "data": {
      "HeWeather6": [{
        "now": {
          "tmp": "11",
          "hum": "82",
          "cond_txt": "Shower Rain",
          "wind_dir": "NNE",
          "wind_spd": "10",
          "cloud": "98"
        },
        "basic": {
          "sr": "07:33",
          "ss": "19:10",
          "location": "Los reartes"
        }
      }]
    }
  }
}
```

---

### 7. Other Endpoints Observed

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/panel/getPanelPageByType` | POST | Load device-specific UI/JS (returns HTML) |
| `/panel/getRefreshBtnShow` | POST | Check if refresh button should be shown |
| `/panel/alertPlantEvent` | GET | Check for plant alerts |
| `/pushAu/isLoginNewServerUser` | POST | Check if user is new |
| `/index/getChuanghuoDeviceList` | POST | Get activation device list |
| `/selectPlant/popupBatteryRemind` | POST | Battery reminder popup check |
| `/homeEnergy/getIsEicUser` | POST | Check EIC user status |
| `/components/getHaveNeo` | POST | Check for Neo components |
| `/nordpool/isNordPool` | POST | Check Nord Pool electricity market |
| `/layout/getIsLayoutType` | GET | Check layout type |
| `/returnDevice/listDevice` | GET | List devices for account |
| `/set/getUserTokenData` | POST | Get API token data |
| `/set/getSelfInfoPage` | GET | User info / settings page |
| `/set/getSystemMonitorSet` | GET | Monitor settings page |
| `/systemMonitor/queryDatalogList` | POST | List data loggers |
| `/systemMonitor/queryMultipleBackflowList` | POST | Multi-device backflow config |
| `/systemMonitor/queryMeterIdList` | POST | List meter IDs |
| `/systemMonitor/queryDeviceSnList` | POST | List device SNs |

---

## Comparison with ShineMonitor

| Feature | ShineMonitor | Growatt |
|---------|-------------|--------|
| Auth | SHA1 hashed password + salt/token | Plaintext password (HTTPS), cookie session |
| Session | Token-based (salt + secret + token) | JSESSIONID cookie |
| CORS | `access-control-allow-origin: *` | **No CORS headers** |
| Browser-side calls | Yes (direct from any domain) | **No** (needs proxy) |
| Battery SOC | Must calculate from voltage | Reported directly (`capacity` field) |
| Status codes | Numeric work state | 28+ descriptive status codes |
| API format | Query string with encoded action | RESTful POST endpoints |
| Device control | `ctrlDevice` endpoint | Not explored (settings page is HTML-based) |

---

## Data Refresh Rate

The device (`ShineWIFI-S` data logger) updates approximately every 5 minutes. The `lastUpdateTime` field indicates the most recent data push from the device.
