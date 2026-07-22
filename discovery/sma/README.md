# SMA Sunny Portal / ennexOS API Discovery — Spike (Phase 5)

Discovery notes for **SMA cloud APIs** behind Sunny Portal (classic) and
Sunny Portal powered by **ennexOS**. This is a **spike**, not an implemented
adapter — see [API.md](API.md) for the full write-up and
[../ADAPTER_GUIDE.md §11](../ADAPTER_GUIDE.md) for what a real adapter would still
need.

## Security

> **Do not commit real credentials.** SMA auth is **OAuth2 client_id +
> client_secret** (issued by SMA Developer Support after a B2B contract), plus
> **plant-owner consent**. Set `SMA_CLIENT_ID` and `SMA_CLIENT_SECRET` in your
> environment before running `fetch_data.py`. Treat the client secret like a
> password — it is used to mint bearer tokens for every API call.

## Quick Start

```bash
export SMA_CLIENT_ID="your-client-id"
export SMA_CLIENT_SECRET="your-client-secret"
# Optional — defaults to production; use sandbox hosts while integrating
export SMA_AUTH_URL="https://auth.smaapis.de"
export SMA_MONITORING_URL="https://monitoring.smaapis.de"
# Optional — skip plant list if already known
# export SMA_PLANT_ID="25057"

python3 fetch_data.py
```

The script obtains a client-credentials token, lists plants, then fetches
`EnergyBalance` for period `Recent` and `Day` (today). Without SMA-issued
sandbox/production credentials the calls will fail at the token endpoint — that
is expected for this documentation-only spike.

## Key Difference From ShineMonitor / Growatt

Unlike ShineMonitor and Growatt (reverse-engineered from consumer portal
network traffic), **SMA publishes official REST APIs** on
[developer.sma.de](https://developer.sma.de/) with OpenAPI/Swagger, OAuth2, and
a free sandbox. There is nothing useful to scrape from `www.sunnyportal.com`
anymore — older cookie/form scrapers were broken years ago when SMA disabled
auto-login and removed the Home Manager JSON endpoint.

Access is gated behind a **B2B onboarding path**, not a self-serve portal
username/password:

1. Contact SMA API Developer Support (`api-developer-support@sma.de` or the
   form on the Developer Portal).
2. Receive sandbox `client_id` / `client_secret`; explore Swagger at
   `sandbox.smaapis.de/monitoring`.
3. Sign the commercial contract; SMA issues production credentials.
4. Obtain **plant-owner consent** via OAuth2 code grant (end-user apps) or
   SMA's custom backchannel flow (O&M / off-screen apps — our likely path).
5. Only then does `GET /v1/plants` return systems; without consent the list is
   empty.

No SMA client credentials were available for this spike, so nothing was
captured from live traffic — everything is sourced from the official Developer
Portal (access control, FAQ, sandbox notes, rate-limit announcement) and the
published Monitoring / Live OpenAPI documents. See API.md for citations.

## Available Data (per official Monitoring + Live APIs)

- **Discovery:** plant list, plant detail/status/installation/location,
  devices under a plant, plant capabilities
- **Near-realtime (Monitoring `Recent`):** plant-level `EnergyBalance` —
  PV generation, load, battery charge/discharge + SOC, grid import/export,
  **diesel generation** (useful for off-grid generator detection)
- **Near-realtime (Live API):** same `EnergyBalance` shape for classic
  WebConnect / Home Manager only — **not allowed for constant O&M polling**
  (max ~10 s interval, terminate after ~10 min session)
- **History:** `Day` / `Week` / `Month` / `Year` / `Total` periods on the same
  measurement sets; device-level PV / battery / consumption / AC / DC sets
- **Other:** plant/device event logs, battery operation state (ennexOS),
  GridControl / SmartHome APIs (out of scope for this dashboard)

See [API.md](API.md) for hosts, OAuth flows, endpoint paths, field →
normalize mapping, and viability notes.

## Spike Conclusion

**Technically strong, commercially and UX-heavy** — see API.md §7. Summary:
`EnergyBalance` maps cleanly onto PLAN.md §3, OpenAPI removes guesswork, and
dieselGeneration is a rare first-class generator signal. But onboarding needs
SMA-issued client credentials, a signed contract (usage is billed), and an
async plant-owner consent step that does not fit today's "paste portal
user/password" modal. **Defer the production adapter** until a user with SMA
API access volunteers (PLAN.md §12, Phase 5).
