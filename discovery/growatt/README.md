# Growatt API Discovery — Casita del Río

Reverse-engineered API for the Growatt SPF 3500 ES solar/storage inverter
monitored via `https://mqtt.growatt.com/`.

## Quick Start

```bash
# Login (get session cookie)
curl -s -X POST 'https://mqtt.growatt.com/login' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'account=riodelmedio&password=rio2909&validateCode=&isReadPact=0&lang=en' \
  -c cookies.txt

# Fetch real-time status
curl -s -X POST 'https://mqtt.growatt.com/panel/storage/getStorageStatusData?plantId=10489936' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -b cookies.txt \
  -d 'storageSn=JQK8NYB00S'

# Fetch energy totals
curl -s -X POST 'https://mqtt.growatt.com/panel/storage/getStorageTotalData?plantId=10489936' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -b cookies.txt \
  -d 'storageSn=JQK8NYB00S'
```

## Key Info

| Item | Value |
|------|-------|
| Plant ID | `10489936` |
| Device SN | `JQK8NYB00S` |
| Data Logger | `DDD0E3G05N` (ShineWIFI-S) |
| Model | SPF 3500 ES (3500W storage inverter) |
| PV Capacity | 2080 W |

## Important: No CORS

Unlike ShineMonitor, the Growatt API does **not** include `access-control-allow-origin` headers.
Direct browser-side API calls from a different domain will be blocked.

**Options for dashboard integration:**
1. **Server-side proxy** — A small backend (Cloudflare Worker, Vercel serverless function, etc.) that forwards requests to Growatt
2. **Self-hosted script** — A cron job that fetches data and writes to a JSON file served statically
3. **Browser extension** — Not practical for sharing

## Available Data

- **Real-time:** PV power, battery voltage/SOC/power, load power, grid power, AC voltages/frequencies, device status
- **Energy totals:** Today/total for PV production, battery charge/discharge, load consumption, grid import/export
- **Charts:** 5-minute interval power data for the day, 7-day battery charge/discharge history, SOC over time
- **Weather:** Temperature, conditions, sunrise/sunset (via HeWeather6)

See [API.md](API.md) for full endpoint documentation.
