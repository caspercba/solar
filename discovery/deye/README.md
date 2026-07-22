# Deye / Solarman Cloud API Discovery — Spike (Phase 5)

Discovery notes for **Deye hybrid/storage inverters** that report through the
IGEN **Solarman** cloud (and the newer branded **DeyeCloud** OpenAPI). This is
a **spike**, not an implemented adapter — see [API.md](API.md) for the full
write-up and [../ADAPTER_GUIDE.md §11](../ADAPTER_GUIDE.md) for what a real
adapter would still need.

## Security

> **Do not commit real credentials.** Auth needs a developer **AppId +
> AppSecret** plus the plant owner's portal **email/username/mobile** and
> **SHA-256 hashed password**. Set them in the environment before running
> `fetch_data.py`. Treat AppSecret like a password — it is required to mint
> every access token.

## Quick Start

```bash
# Required — developer app from Solarman business / DeyeCloud developer portal
export DEYE_APP_ID="your-app-id"
export DEYE_APP_SECRET="your-app-secret"

# Portal account that owns (or is authorized for) the plant
export DEYE_EMAIL="owner@example.com"          # or DEYE_USERNAME / DEYE_MOBILE
export DEYE_PASSWORD="plaintext-password"      # script SHA-256s it; or set DEYE_PASSWORD_SHA256

# Flavor + host (defaults shown)
#   solarman  → classic Solarman OpenAPI paths (.../v1.0/...)
#   deyecloud → DeyeCloud developer hosts (paths under /v1.0/)
export DEYE_API_FLAVOR="solarman"
export DEYE_API_URL="https://globalapi.solarmanpv.com"

# Optional — skip discovery if already known
# export DEYE_STATION_ID="895"
# export DEYE_DEVICE_SN="dev1800078101"

python3 fetch_data.py
```

**DeyeCloud example:**

```bash
export DEYE_API_FLAVOR="deyecloud"
export DEYE_API_URL="https://eu1-developer.deyecloud.com/v1.0"
# US: https://us1-developer.deyecloud.com/v1.0
python3 fetch_data.py
```

Without valid AppId/AppSecret and a portal account the token call fails — that
is expected for this documentation-only spike.

## Two Related Clouds

| Portal | Who uses it | Official docs | Self-serve AppId? |
|--------|-------------|---------------|-------------------|
| **Solarman** (IGEN / `solarmanpv.com`) | Many Deye / Sunsynk / Sol-Ark / Sofar sticks historically paired here | [doc.solarmanpv.com](https://doc.solarmanpv.com/en/Documentation%20and%20Quick%20Guide) + OpenAPI PDFs | Email `service@solarmanpv.com` (business review) |
| **DeyeCloud** (`deyecloud.com`) | Newer Deye-branded app/cloud; same logger family, regional developer hosts | [developer.deyecloud.com](https://developer.deyecloud.com/) + [sample code](https://github.com/DeyeCloudDevelopers/deye-openapi-client-sample-code) | Create an app in the developer portal after a DeyeCloud account |

Auth shape, station list, and plant-level power fields are **nearly identical**.
DeyeCloud renames a few paths (`/station/latest` vs Solarman
`/station/v1.0/realTime`, `granularity`/`startAt` vs `timeType`/`startTime`)
and ships regional bases (`eu1-developer` / `us1-developer`). Community notes
say DeyeCloud still rides Solarman-family infrastructure.

**Out of scope for this cloud spike:** local logger Modbus via Solarman V5
TCP/8899 (`pysolarmanv5`, Home Assistant `solarman` integration). That path is
LAN-only and does not need a Worker proxy — different product surface.

No live AppId was available for this spike, so nothing was captured from a
real plant — examples below come from published OpenAPI PDFs, the DeyeCloud
sample repo, and mature community clients (`sincze/solarman-mqtt`, HA threads).

## Available Data (per published OpenAPI)

- **Discovery:** station list (id, name, capacity, timezone), devices under a
  station (`INVERTER` / `COLLECTOR` / …)
- **Realtime (station):** generation, load (`usePower`), battery SOC + power,
  charge/discharge, grid purchase / wire / feed-in
- **Realtime (device):** key/name/unit `dataList` (PV strings, AC, battery
  detail — model-dependent keys)
- **History:** station + device series at frame / day / month / year
  granularity (intraday + multi-day totals)
- **Extra (DeyeCloud):** battery / TOU / work-mode remote control endpoints
  (out of scope for read-only dashboard)

See [API.md](API.md) for hosts, auth, field → normalize mapping, and viability.

## Spike Conclusion

**Technically strong for a Worker adapter** — station realtime maps cleanly
onto PLAN.md §3, history exists at day and frame resolution, and auth is a
long-lived bearer token (~60 days) rather than a 4–5 min cookie. **Defer
building** until a user with AppId + plant access volunteers: onboarding
still needs a developer app (not just portal user/password), and battery /
grid sign conventions need a live fixture pass. Details in API.md §7.
