# 0003: Password users and admin-issued magic-link invites

## Context

ADR 0002 delivered **opaque per-user API keys** (`read` / `admin`) and a mutation audit log. That model fits machine clients (Home Assistant) and trusted operators who paste a bearer token, but it is not a comfortable **human account** model:

- The primary UX today is still **proxy URL + access token** (setup form and `?proxy=…&token=…` deep links).
- There is no username/password login, no invite flow, and no admin UI to see *people* (only token labels).
- Sharing a long opaque token (or the household `API_TOKEN`) via chat/email is brittle; rotating one person's access is awkward without a first-class user record.

Product goal: support **multiple human users** on one Worker deployment. An **admin** (god-level operator) can invite people, manage accounts and permissions, and clean up unused invites — without building email delivery in v1.

## Decision

Add a **password-backed user registry** and **admin-issued magic-link invites** on top of the existing Worker + KV stack. Keep ADR 0002 opaque API keys for machines and for the post-login session credential the browser stores. Do **not** add a third-party IdP, email SMTP, or JWT as the primary session format.

### Roles

| Role | Capabilities |
|------|----------------|
| `admin` | Full API access; user CRUD; mint/list/revoke invites; mint/revoke opaque API keys (ADR 0002); system CRUD and alert config. Bootstrap / god user. |
| `read` | Dashboard polling, history, HA bridge — same as today's `read` token role. No mutations, no admin surfaces. |

Future roles (e.g. per-system ACL) are out of scope for the first cut; permissions are global per user.

### Users (KV)

```
user:<id> → {
  id, username, passwordHash, role,
  createdAt, createdBy?,
  disabledAt?,
  lastLoginAt?
}
_index_users → [{ id, username, role, createdAt, disabledAt? }]
```

- Store **password hashes only** (e.g. PBKDF2 / scrypt via Web Crypto — exact algorithm chosen at implementation; never plaintext).
- Usernames are unique (case-normalized).
- Soft-disable (`disabledAt`) or hard-delete are both acceptable; prefer soft-disable so audit history stays attributable, with hard-delete as an admin option that also revokes that user's sessions/keys.
- Bootstrap: the first `admin` user is created by an existing `admin` bearer (legacy `API_TOKEN` or ADR 0002 admin key) via `POST /api/admin/users`, or by a one-time Wrangler/bootstrap path documented in `DEPLOY.md`. After at least one password admin exists, day-to-day ops use username/password login.

### Magic-link invites (KV)

Admin creates an invite; the Worker returns a **full URL** the admin copies and sends out-of-band (WhatsApp, SMS, email client — product does not send mail in v1).

```
invite:<sha256(secret)> → {
  id, role,           // role granted on conversion
  label?,             // optional note, e.g. "neighbor Ana"
  status,             // pending | converted | revoked | expired
  createdAt, createdBy,
  expiresAt,
  convertedAt?, convertedUserId?,
  consumedAt?         // set when password is set / user created
}
_index_invites → [{ id, label?, role, status, createdAt, expiresAt, convertedUserId? }]
```

- Invite secret is a high-entropy opaque value; only a **hash** is stored in KV (same pattern as ADR 0002 tokens).
- Frontend route/query e.g. `?proxy=…&invite=<secret>` (or `/#/invite/<secret>`) opens a **set username + password** screen; on success the invite becomes `converted` and a `user:` record is created.
- If the invitee already has an account, the link is rejected or limited to "set/reset password for this invite's target" — v1 assumes **new user creation only** (invite = onboarding). Password reset for existing users can reuse the same invite machinery in a later iteration (`purpose: onboard | reset`).
- Admin can **revoke** (deprecate) a pending invite so the link stops working; expired invites are treated as invalid and can be purged from the index for cleanup.
- Admin UI lists invites with status so operators see **emitted vs converted vs revoked/expired**.

### Login and browser session

1. Frontend setup gains **username + password** login (proxy URL still required).
2. `POST /api/auth/login` → validates credentials → mints (or rotates) an opaque session token tied to `userId` + role (reuse / extend `tokens.js` registry with `userId` field, or a dedicated `session:` map — implementation detail).
3. Browser stores that bearer token in `localStorage` as today; subsequent API calls stay `Authorization: Bearer …`.
4. Legacy `?token=` deep links and the shared `API_TOKEN` remain supported for HA and bookmarks during migration; prefer documenting password login as the human path going forward.

### Admin surfaces (product)

Admin-only UI (settings or dedicated panel) and matching Worker routes:

| Action | Behavior |
|--------|----------|
| List users | Username, role, created, last login, disabled |
| Create user | Username + password + role (immediate account, no invite) |
| Remove / disable user | Revoke their sessions/opaque keys; block login |
| Change role | `read` ↔ `admin` (cannot lock out the last admin) |
| Create invite | Choose role (+ optional label, TTL); show **copyable magic link** once |
| List invites | Status, created, expiry, converted user |
| Revoke invite | Pending → revoked |
| Purge stale invites | Remove revoked/expired/converted entries from index (optional bulk cleanup) |

All of the above are audited (extend ADR 0002 `auditLog` actions: `user.create`, `user.delete`, `invite.create`, `invite.revoke`, `auth.login` optional — login may be noisy; prefer failed-login rate limits over full success logging).

### Planned API surface (indicative)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/login` | `{ username, password }` → `{ token, role, username }` |
| `POST` | `/api/auth/logout` | Revoke current session token |
| `GET` | `/api/me` | Current actor (`userId` / `tokenId`, `username?`, `role`) |
| `POST` | `/api/auth/invite/accept` | `{ invite, username, password }` → creates user + session (no prior auth) |
| `GET` | `/api/admin/users` | List users |
| `POST` | `/api/admin/users` | Create user with password |
| `DELETE` | `/api/admin/users/:id` | Disable or delete user |
| `PATCH` | `/api/admin/users/:id` | Update role / re-enable |
| `POST` | `/api/admin/invites` | Mint invite → returns `{ id, url, expiresAt }` (plaintext secret only once) |
| `GET` | `/api/admin/invites` | List invites + conversion status |
| `DELETE` | `/api/admin/invites/:id` | Revoke pending invite |
| `POST` | `/api/admin/invites/purge` | Optional: drop non-pending invites from index |

Exact paths may shift at implementation time; behavior above is normative.

### What we deliberately skip in v1

- Outbound email / SMS from the Worker (admin copies the link).
- Self-service signup without an invite.
- OAuth / Cloudflare Access as end-user login (Access remains optional for ops hardening per ADR 0002 Phase 3).
- Per-system permissions.
- Mandatory migration off `API_TOKEN` (stays for HA and break-glass).

## Consequences

- **Human onboarding** becomes invite → set password → login, while **machines** keep opaque keys.
- **Admin is accountable** for who was invited and who converted; unused links can be revoked and purged.
- **KV grows** (`user:*`, `invite:*` indexes) but stays within the existing single `SYSTEMS` namespace unless volume justifies a split later.
- **Frontend work is required** (login, accept-invite, admin users/invites panels) — unlike ADR 0002 Phases 1–2 which were Worker-only.
- **Security bar rises**: password hashing, invite single-use, invite TTL, rate-limit login and invite-accept, never log passwords or raw invite secrets.

## Alternatives considered

| Option | Verdict |
|--------|---------|
| Stay on opaque API keys only (ADR 0002) | Insufficient for invite/password UX and user directory |
| Email-delivered magic links (SendGrid, etc.) | Deferred — copy-to-clipboard is enough for small deployments |
| Cloudflare Access as primary login | Rejected for end users (same reasons as ADR 0002); optional for admin later |
| JWT sessions | Rejected — opaque KV-backed sessions/tokens match existing auth and revoke story |
| Third-party auth (Clerk, Auth0) | Out of scope — breaks zero-build / minimal-deps posture |

## Relationship to ADR 0002

| ADR 0002 | ADR 0003 |
|----------|----------|
| Opaque API keys + roles | Password **users** + magic-link **invites** |
| Token label ≈ nickname | Real username + hashed password |
| Mint key → paste in setup | Invite link → set password → login → session token |
| Done (Phases 1–2) | Done |

Opaque keys remain; user login issues or binds a key/session so `checkAuth`, rate limits, and audit `actorId` keep working.

## Recommendation summary

Shipped end-to-end at **v1.4.0**: Worker user/invite modules and auth routes, frontend login/accept-invite and admin management UI, and Playwright E2E. Shared `API_TOKEN` and HA keys remain supported alongside password sessions.
