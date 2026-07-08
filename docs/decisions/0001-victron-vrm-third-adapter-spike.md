# 0001: Choose Victron VRM as the Phase 5 third-adapter discovery target

## Context

`PLAN.md` §10.3 lists Victron VRM, Solis, and Deye as candidate third adapters
("Nice to Have — Additional adapters"), with the choice left "TBD by user need." The
current task asked for a discovery-only spike (`discovery/<brand>/README.md`, `API.md`,
`fetch_data.py`) to seed a future adapter, following the same pattern as
`discovery/` (ShineMonitor) and `discovery/growatt/`.

No physical Victron hardware or VRM test account is available in this environment, unlike
the existing two discovery folders, which were built from real captured traffic against
the project's own inverters. This spike is necessarily a literature review (official docs
+ community sources), not a validated capture.

## Decision

1. **Victron VRM is the adapter to spike**, not Solis or Deye. Rationale:
   - VRM has **official public API documentation** (`vrm-api-docs.victronenergy.com`)
     and a first-party Python client (`victronenergy/vrm-api-python-client`). Solis and
     Deye, like ShineMonitor and Growatt, would require traffic capture against real
     hardware — Victron is the only one of the three where credible endpoint docs exist
     without owning the hardware. This substantially lowers implementation risk.
   - Victron off-grid inverters (MultiPlus/Quattro) fit the same target market
     (off-grid/hybrid homeowners) as the existing adapters.
2. **Recommend Personal Access Token (PAT) auth over username/password** for a future
   adapter's credential storage, even though VRM supports both. Login-based auth fails
   outright on accounts with 2FA enabled, which a fully automated `discover()` flow
   (per `ADAPTER_GUIDE.md` §3.3) cannot complete. A PAT sidesteps 2FA entirely and has no
   observed session-expiry behavior to manage, unlike ShineMonitor's 5-minute token TTL
   or Growatt's 4-minute cookie TTL.
3. **Flag, but do not resolve, the multi-device discovery gap.** ShineMonitor and Growatt
   both assume one inverter device per plant, captured once at setup. VRM sites commonly
   expose several distinct devices (battery monitor, one or more solar chargers,
   VE.Bus/Quattro inverter), each with its own `instance` number in the `diagnostics`
   response. Building a single normalized `fetchData()` snapshot means the future
   adapter's `discover()` needs an **instance role map** — which `instance` is the battery
   monitor, which are solar chargers to sum, which is the AC inverter — not just a single
   device serial like `storageSn`. This is out of scope for the current spike and is
   recorded as a design risk for whoever implements the adapter.
4. **No Worker adapter, router registration, or `buildCredentials()` changes in this
   pass.** Per the task's acceptance criteria, this is discovery only.

## Consequences

- `discovery/victron/` now documents a plausible auth flow, discovery/realtime/history
  endpoints, and a feasibility assessment against the normalized contract in `PLAN.md`
  §3.1, matching the layout `ADAPTER_GUIDE.md` §2 already prescribes for a Victron
  adapter.
- Because nothing here was run against a live account, **the next step before writing
  `worker/src/services/victron.js` is a live verification pass**: run
  `discovery/victron/fetch_data.py` against a real VRM account/token, confirm the
  attribute `code` values for battery voltage/current and load/grid power, and confirm
  the `stats` endpoint's `interval` enum. A follow-up task captures this (see
  `.gordofast/tasks.json`).
- `PLAN.md` §10.3 idea #10 can be considered "spiked" for Victron; Solis and Deye remain
  fully open.

## Alternatives considered

- **Solis or Deye instead of Victron** — rejected for this spike because neither has
  public API docs; both would require the same traffic-capture workflow already used for
  ShineMonitor/Growatt, which isn't possible without hardware access. Revisit if a user
  with Solis/Deye hardware requests it (per PLAN's "TBD by user need").
- **Username/password as the adapter's stored credential (matching Growatt's pattern)**
  — rejected as the *recommended* default because of the 2FA gap; still documented as a
  fallback path in `fetch_data.py` for accounts without 2FA.
- **Implementing the Worker adapter now instead of stopping at discovery** — rejected;
  the task scope is explicitly discovery-only, and doing so before live-verifying
  attribute codes would risk shipping parsing logic against guessed field names.
