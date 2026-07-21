# Architecture

_Last updated: 2026-07-21_

Companion to [PLAN.md](./PLAN.md) and [STATE.md](./STATE.md). Implementation details and deploy steps live in [README.md](./README.md) and [worker/DEPLOY.md](./worker/DEPLOY.md). Auth evolution: [ADR 0002](./docs/decisions/0002-multi-user-token-and-audit-log.md) (opaque keys + audit), [ADR 0003](./docs/decisions/0003-password-users-and-magic-link-invites.md) (password users + magic-link invites — planned).

## 1. System overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Static frontend (index.html, app.js, style.css, frontend/*)             │
│  Host: Cloudflare Pages / GitHub Pages / any static host                 │
│  No build step — cache-bust ?v=N on assets                               │
│  Client state: localStorage (proxy URL, bearer token, prefs, view)       │
│  Auth UX (today): paste token / ?token=…                                 │
│  Auth UX (planned, ADR 0003): login, accept-invite, admin user panel     │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ HTTPS
                                │ Authorization: Bearer <token>
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Cloudflare Worker (worker/)                                             │
│  • checkAuth — legacy API_TOKEN, then KV opaque keys (ADR 0002)          │
│  • Planned: login / invite-accept → session token bound to user (0003) │
│  • Adapters: shinemonitor, growatt                                       │
│  • Optional cron: SOC / generator alert webhooks                         │
│  • Rate limit + structured / audit logging                               │
└───────────────┬─────────────────────────────┬────────────────────────────┘
                │                             │
                ▼                             ▼
┌───────────────────────────┐   ┌─────────────────────────────────────────┐
│  Workers KV (SYSTEMS)     │   │  Vendor cloud APIs                      │
│  systems, credentials,    │   │  ShineMonitor · Growatt                 │
│  alert state, opaque keys │   │  History fetched on demand — not stored │
│  Planned: users, invites  │   └─────────────────────────────────────────┘
└───────────────────────────┘
```

## 2. Design principles

1. **Normalize at the adapter boundary** — frontend speaks one JSON shape ([PLAN.md §3](./PLAN.md)).
2. **Discover once, poll many** — plant/device identity stored in KV at setup.
3. **Vendor is source of truth for history** — no archival time-series in KV.
4. **Zero frontend build step** — plain HTML/CSS/JS.
5. **Secrets stay on the Worker** — inverter portal credentials encrypted in KV; browser holds only a bearer token (and proxy URL).
6. **Auth layers compose** — shared secret → opaque keys (done) → password users + invites (planned); machines keep keys, humans get accounts.

## 3. Auth model

### 3.1 Current (shipped)

| Mechanism | Who | How |
|-----------|-----|-----|
| Shared `API_TOKEN` | Household / break-glass / HA | Worker secret; `Authorization: Bearer …`; actor `shared`, role `admin` |
| Opaque KV API keys | Per-person or per-integration | Minted via `POST /api/admin/tokens`; roles `read` \| `admin`; revoke by id |
| URL deep link | Bookmarks / home screen | `?proxy=…&token=…` → stored in `localStorage` |

Mutating routes require `admin`. Reads allow `read` or `admin`. Mutation audit log attributes `actorId` (ADR 0002).

### 3.2 Planned — password users & magic links (ADR 0003)

```
Admin (god)                    Invitee                         Browser session
────────────                   ───────                         ───────────────
Create invite ──► copy URL ──► open link ──► set user+pass ──► login
     │                              │                              │
     ▼                              ▼                              ▼
_index_invites               invite → converted              opaque session
list: pending/converted      user:<id> created               token ↔ userId+role
revoke / purge stale
```

**Admin capabilities (planned):**

- List users with roles; create user with username + password; disable/remove users; change roles.
- Issue magic links (copyable); see which invites converted; revoke pending links; purge dead invites.
- Retain existing opaque API key admin routes for HA / automation.

**Invitee path:** magic link only grants **account creation + password set** (v1). No product email sender — admin distributes the link personally.

**Login path:** username + password → session bearer (same header as today) → dashboard. Legacy `?token=` remains for migration and machine bookmarks.

### 3.3 Trust and threat notes

- Bearer tokens in `localStorage` / URL history remain a trusted-device assumption; prefer password login + shorter-lived session tokens when implemented.
- Invite secrets are single-use, TTL-bound, hash-stored; revoke cleans up shared-by-mistake links.
- Password hashes only in KV; never log passwords, raw invites, or bearer secrets.
- Rate-limit `login` and `invite/accept` separately from data polling.

## 4. Data in KV

| Key pattern | Purpose | Status |
|-------------|---------|--------|
| `_index` | System list `{ id, name, service }` | Shipped |
| `system:<uuid>` | Config + encrypted inverter credentials | Shipped |
| `alert-state:<uuid>` | Alert cooldown | Shipped |
| `token:<sha256>` / `token-id:<id>` / `_index_tokens` | Opaque API keys | Shipped (ADR 0002) |
| `user:<id>` / `_index_users` | Password users | Planned (ADR 0003) |
| `invite:<sha256>` / `_index_invites` | Magic-link invites + conversion tracking | Planned (ADR 0003) |

No historical power readings are stored.

## 5. Request path (realtime)

1. Frontend polls `GET /api/systems/:id/data` (and optionally `/all/data`) on an interval.
2. Worker authenticates bearer → loads `system:<id>` → decrypts credentials → adapter `fetchData()` (vendor session cache per isolate).
3. Normalized JSON returned to `renderData()`; generator runtime and UI prefs stay client-side.

History and summary routes call `fetchHistory` / `fetchHistorySummary` on the same adapters without writing series to KV.

## 6. Repository map

| Path | Role |
|------|------|
| `index.html`, `app.js`, `style.css` | SPA shell |
| `frontend/` | Pure helpers + i18n (unit-tested) |
| `worker/src/` | Router, auth, tokens, credentials, adapters, alerts, HA |
| `worker/test/` | Vitest + Miniflare |
| `e2e/` | Playwright + mock Worker |
| `discovery/` | Vendor API notes and Python probes |
| `docs/decisions/` | ADRs |
| `PLAN.md` / `STATE.md` | Roadmap and status |
| `ARCHITECTURE.md` | This document |

## 7. Deployment topology

- **Worker** — `solar-proxy` (+ `staging` env), KV bound as `SYSTEMS`, secrets `API_TOKEN`, `CREDENTIALS_KEY`, `ALLOWED_ORIGINS`, `PRODUCTION`.
- **Frontend** — Cloudflare Pages from `main`.
- **CI** — worker + frontend unit + E2E on PR/`main`; production Worker deploy on semver tags.
- Frontend and Worker stay **independently deployable** (different origins; CORS allowlist).

## 8. Related docs

- Product plan & phases: [PLAN.md](./PLAN.md)
- Current status: [STATE.md](./STATE.md)
- Operator deploy: [worker/DEPLOY.md](./worker/DEPLOY.md)
- Adapter guide: [discovery/ADAPTER_GUIDE.md](./discovery/ADAPTER_GUIDE.md)
