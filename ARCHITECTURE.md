# Architecture

_Last updated: 2026-07-26_

Companion to [PLAN.md](./PLAN.md) and [STATE.md](./STATE.md). Implementation details and deploy steps live in [README.md](./README.md) and [worker/DEPLOY.md](./worker/DEPLOY.md). Auth evolution: [ADR 0002](./docs/decisions/0002-multi-user-token-and-audit-log.md) (opaque keys + audit), [ADR 0003](./docs/decisions/0003-password-users-and-magic-link-invites.md) (password users + magic-link invites — Worker routes and full frontend auth UX shipped: password login, accept-invite, admin users/invites panels, logout/session-expiry; legacy `?token=` / pasted bearer retained for HA and migration). UI mocks for planned Cards work live under [docs/mocks/](./docs/mocks/).

## 1. System overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Static frontend (index.html, app.js, style.css, frontend/*)             │
│  Host: Cloudflare Pages / GitHub Pages / any static host                 │
│  No build step — cache-bust ?v=N on assets                               │
│  Client state: localStorage (proxy URL, bearer token, prefs, view)       │
│  Auth UX: username/password login (primary); ?invite= accept-invite      │
│  screen; admin users CRUD + mint/list/revoke/purge magic-link invites;   │
│  logout + session-expiry. ?token=/pasted bearer kept for HA & migration. │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ HTTPS
                                │ Authorization: Bearer <token>
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Cloudflare Worker (worker/)                                             │
│  • checkAuth — legacy API_TOKEN, KV opaque keys (0002), or a             │
│    session bearer from login/invite-accept, bound to a user (0003)       │
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
│  + users, invites (0003)  │   └─────────────────────────────────────────┘
└───────────────────────────┘
```

## 2. Design principles

1. **Normalize at the adapter boundary** — frontend speaks one JSON shape ([PLAN.md §3](./PLAN.md)).
2. **Discover once, poll many** — plant/device identity stored in KV at setup.
3. **Vendor is source of truth for history** — no archival time-series in KV.
4. **Zero frontend build step** — plain HTML/CSS/JS.
5. **Secrets stay on the Worker** — inverter portal credentials encrypted in KV; browser holds only a bearer token (and proxy URL).
6. **Auth layers compose** — shared secret → opaque keys → password users + invites (shipped end-to-end); machines keep keys, humans get accounts.

## 3. Auth model

### 3.1 Current (shipped)

| Mechanism | Who | How |
|-----------|-----|-----|
| Shared `API_TOKEN` | Household / break-glass / HA | Worker secret; `Authorization: Bearer …`; actor `shared`, role `admin` |
| Opaque KV API keys | Per-person or per-integration | Minted via `POST /api/admin/tokens`; roles `read` \| `admin`; revoke by id |
| Password login / session | Human users (primary path) | `POST /api/auth/login` → opaque session bearer bound to `userId` + role; stored in `localStorage` like any other token (ADR 0003) |
| URL deep link | Bookmarks / home screen / migration | `?proxy=…&token=…` → stored in `localStorage` |

Mutating routes require `admin`. Reads allow `read` or `admin`. Mutation audit log attributes `actorId` (ADR 0002).

### 3.2 Password users & magic links (ADR 0003)

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

**Worker routes — shipped:** `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`, `POST /api/auth/invite/accept`, `GET`/`POST /api/admin/users`, `PATCH`/`DELETE /api/admin/users/:id`, `GET`/`POST /api/admin/invites`, `DELETE /api/admin/invites/:id`, `POST /api/admin/invites/purge`. Passwords hashed with PBKDF2-SHA-256; invite secrets hash-stored like opaque keys; last-admin protection on role/disable/delete; login and invite-accept are rate-limited per client IP.

**Admin capabilities (shipped end-to-end — Worker + settings UI):**

- List users with roles; create user with username + password; disable/remove (soft by default, `?hard=1` for hard-delete); change roles.
- Issue magic links (copyable); see which invites converted; revoke pending links; purge dead invites (mint form + invites list with revoke/purge).
- Retain existing opaque API key admin routes for HA / automation — unchanged.

**Invitee path:** `?proxy=…&invite=<secret>` opens the accept-invite screen → username + password → `POST /api/auth/invite/accept` creates the account and returns a session bearer (v1: new-user onboarding only). No product email sender — admin distributes the link personally.

**Login path:** username + password → session bearer (same header as today) → dashboard. **Shipped** as the primary frontend setup-screen flow, with logout and session-expiry UX. Legacy `?token=` and pasted opaque keys remain for migration and machine bookmarks.

**Frontend status:** ADR 0003 UI complete (see [PLAN.md §5.3](./PLAN.md#53-multi-user-accounts--invites-planned--adr-0003) and [ADR 0003](./docs/decisions/0003-password-users-and-magic-link-invites.md)) — password login, accept-invite, admin users/invites panels, logout/session-expiry, and retained legacy token path.

### 3.3 Trust and threat notes

- Bearer tokens in `localStorage` / URL history remain a trusted-device assumption; prefer password login + session tokens over long-lived `?token=` bookmarks for humans.
- Invite secrets are single-use, TTL-bound, hash-stored; revoke cleans up shared-by-mistake links.
- Password hashes only in KV; never log passwords, raw invites, or bearer secrets.
- Rate-limit `login` and `invite/accept` separately from data polling.

## 4. Data in KV

| Key pattern | Purpose | Status |
|-------------|---------|--------|
| `_index` | System list `{ id, name, service }` | Shipped |
| `system:<uuid>` | Config + encrypted inverter credentials | Shipped |
| `alert-state:<uuid>` | Alert cooldown | Shipped |
| `token:<sha256>` / `token-id:<id>` / `_index_tokens` | Opaque API keys + user sessions | Shipped (ADR 0002; sessions added in 0003) |
| `user:<id>` / `_index_users` | Password users | Shipped (ADR 0003) |
| `invite:<sha256>` / `_index_invites` | Magic-link invites + conversion tracking | Shipped (ADR 0003) |

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
