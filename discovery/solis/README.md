# Solis Cloud API Discovery — Spike (Phase 5)

Discovery notes for **SolisCloud** (Ginlong Technologies), the cloud portal behind
Solis hybrid/storage inverters (`soliscloud.com`). This is a **spike**, not an
implemented adapter — see [API.md](API.md) for the full write-up and
[../ADAPTER_GUIDE.md §11](../ADAPTER_GUIDE.md) for what a real adapter would still
need.

## Security

> **Do not commit real credentials.** SolisCloud auth is an **API key ID + secret**
> (not a username/password), obtained through Solis support (see §1 of API.md).
> Set `SOLIS_KEY_ID` and `SOLIS_KEY_SECRET` in your environment before running
> `fetch_data.py`. Treat the key secret like a password — it signs every request.

## Quick Start

```bash
export SOLIS_KEY_ID="your-api-id"
export SOLIS_KEY_SECRET="your-api-secret"
# Optional — defaults to the global portal; Solis support may assign a
# region-specific host (see API.md §2)
export SOLIS_API_URL="https://www.soliscloud.com:13333"

python3 fetch_data.py
```

The script signs and calls `userStationList` → `stationDetail` → `inverterList` →
`inverterDetail` → `inverterDay`, printing normalized-ish output for manual
inspection.

## Key Difference From ShineMonitor / Growatt

Unlike ShineMonitor and Growatt (reverse-engineered from the consumer web
portal's network traffic), **SolisCloud publishes an official B2B monitoring
API** (`SolisCloud Platform API Document`, currently v2.0.x) intended for
third-party integrators. There is nothing to "capture" from a browser — the
API is documented, but access is gated behind a manual approval step:

1. Log in to soliscloud.com, open **API Management**, click **Activate now**.
2. Agree to usage terms → **View Key** → complete a puzzle captcha → a
   verification code is emailed (valid ~60 seconds).
3. Solis (sometimes via a regional installer/support contact) approves the
   request — this can take from minutes to a few business days depending on
   region.
4. Once approved, the dashboard shows `KeyId` and `KeySecret`, scoped to the
   plants under that SolisCloud account.

No test account/API key was available for this spike, so nothing here was
captured from live traffic — everything is sourced from the official API
document, the vendor support KB, and cross-checked against the field/endpoint
names used by mature open-source clients (`hultenvp/soliscloud_api` and
derivatives). See API.md for citations.

## Available Data (per official spec)

- **Discovery:** power station list, station detail, inverter list (per
  account or per station)
- **Real-time:** `inverterDetail` — AC/DC power, PV string voltage/current,
  battery voltage/power/SOC, load power, grid import/export, energy
  today/month/year/total, inverter run status
- **History:** `inverterDay` (5-minute series for one day), `inverterMonth` /
  `inverterYear` (daily/monthly energy totals), station-level day/month/year
  equivalents
- **Alarms:** `alarmList`

See [API.md](API.md) for endpoint paths, request/response shapes, and sign
conventions to reuse if this becomes a real adapter.

## Spike Conclusion

**Adapter looks viable, but not urgent** — see API.md §7 for the full
assessment. Summary: the API is well-documented and stable (a real advantage
over Growatt's undocumented portal), but the manual key-activation step means
a user can't self-serve "add my Solis system" the way they can today with
ShineMonitor/Growatt (just enter portal username + password). That UX gap,
plus a modest per-IP rate limit (3 req / 5 s), are the reasons to defer
building the production adapter until a user actually asks for Solis support
(PLAN.md §12, Phase 5).
