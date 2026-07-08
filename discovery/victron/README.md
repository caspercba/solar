# Victron VRM API Discovery — Spike

Phase 5 discovery pass for a potential third inverter adapter. **No live VRM test
account was available during this spike** — the notes and script here are compiled from
Victron's official API docs (`https://vrm-api-docs.victronenergy.com/`), the first-party
`vrm-api-python-client`, and community reports, not from captured traffic against a real
system (unlike the ShineMonitor and Growatt discovery folders, which were built against
this project's own hardware).

**Status: literature review, not validated.** Before implementing a Worker adapter,
someone with a VRM account needs to run `fetch_data.py` against it and confirm the
attribute codes and endpoint shapes in [API.md](API.md).

## Security

> **Do not commit real credentials or access tokens.** Set `VRM_TOKEN` (preferred, a
> Personal Access Token) or `VRM_USERNAME`/`VRM_PASSWORD` in your environment before
> running `fetch_data.py`.

## Why Victron VRM

Per `PLAN.md` §10.3 (idea #10), the project has flagged Victron VRM, Solis, and Deye as
candidate third adapters. VRM was chosen for this spike because:

- It's Victron's own multi-tenant cloud with **official public API docs and a first-party
  Python client** — much lower reverse-engineering risk than ShineMonitor/Growatt, which
  were built purely from captured browser traffic.
- Victron off-grid/hybrid inverters (MultiPlus, Quattro) are common in the same
  homeowner/off-grid-cabin market this dashboard targets.

See [API.md](API.md) for the full endpoint reference, and the ADR under
`.gordofast/adr/` for the recorded decision and alternatives considered (Solis, Deye).

## Quick Start

```bash
# Personal Access Token (recommended — create at
# https://vrm.victronenergy.com/access-tokens under Preferences → Integrations)
export VRM_TOKEN=your_personal_access_token

# OR username/password (fails on accounts with 2FA enabled — see API.md)
export VRM_USERNAME=you@example.com
export VRM_PASSWORD=your_password

python3 fetch_data.py
```

The script:

1. Authenticates (PAT header, or `/v2/auth/login` if only username/password is set).
2. Lists installations for the account (`GET /v2/users/{idUser}/installations`).
3. Fetches the latest diagnostics snapshot for the first installation
   (`GET /v2/installations/{idSite}/diagnostics?count=1`) and prints raw records — field
   names are **not yet mapped** to the normalized contract because the exact `code`
   values need confirming against real output first.

## Key Info

| Item | Value |
|------|-------|
| Base URL | `https://vrmapi.victronenergy.com/v2` |
| Auth | Personal Access Token (`X-Authorization: Token <token>`) or login token (`X-Authorization: Bearer <token>`) |
| Official docs | `https://vrm-api-docs.victronenergy.com/` |
| Python client | `github.com/victronenergy/vrm-api-python-client` |

## No CORS (confirmed)

Like Growatt, VRM does not return usable CORS headers for browser-side requests —
community reports describe the API working from servers/scripts but being blocked from
browser JS. **A server-side proxy is required**, which the existing Cloudflare Worker
already provides — no new architectural pattern needed if an adapter is built.

## Available Data (per public docs)

- **Realtime:** flat list of `{code, formattedValue, rawValue}` diagnostic records
  spanning every device on a site (battery monitor, solar chargers, VE.Bus/Quattro
  inverter) — see [API.md](API.md) for the multi-device caveat.
- **History:** `stats` endpoint with a `type` + `interval` param (`15mins`/`hours`/`days`
  — exact enum unconfirmed) — looks capable of covering both the intraday chart and
  multi-day summary contracts in one endpoint shape.

See [API.md](API.md) for full endpoint documentation, the ShineMonitor/Growatt comparison
table, and the feasibility assessment against `PLAN.md` §3.1's normalized data contract.
