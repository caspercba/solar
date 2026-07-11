# 0002: Multi-user access token and audit-log design

## Context

`PLAN.md` §13 Q5 asks whether a single shared `API_TOKEN` is sufficient or whether the Solar Dashboard needs **per-user tokens** and an **audit trail**. Today the architecture is:

- **Static frontend** stores proxy URL + bearer token in `localStorage` (and optionally in URL query params for home-screen bookmarks).
- **Cloudflare Worker** validates `Authorization: Bearer <token>` against one secret (`env.API_TOKEN`) in `worker/src/auth.js`.
- **Per-token rate limiting** already keys off the raw bearer string on data routes (`worker/src/rateLimit.js`).
- **Mutating routes** that change shared state: `POST /api/systems`, `PUT /api/systems/:id/credentials`, `PUT /api/systems/:id/alerts`, `DELETE /api/systems/:id`.
- **Target users** are homeowners and small multi-property operators — not enterprise teams with SSO directories.

There is no actor identity today: every authorized request is indistinguishable, and revoking one person's access requires rotating the shared token for everyone.

## Decision

Adopt a **phased model** — keep the shared token as the default deployment, add **optional per-user opaque API keys in KV** when multi-user is required, and implement a **mutation-only audit log** that attributes admin actions to a token identity. **Do not** adopt Cloudflare Access as the primary auth path for this product.

### Phase 0 — Default (current; no code change)

Continue shipping with a single `API_TOKEN` Worker secret for deployments where one household or a fully trusted small group shares access. Document rotation in `worker/DEPLOY.md` (generate new secret → `wrangler secret put API_TOKEN` → update each client's setup screen / bookmark URL → verify → decommission old token).

**When this is enough:** one operator, family members who all trust each other, or HA REST sensors using the same token.

### Phase 1 — Mutation audit log (recommended next step if audit is the driver)

Log **state-changing API calls only** — not polling reads (`/data`, `/history`, `/ha`).

Each audit entry (structured JSON via existing `logger.js`, optionally persisted):

| Field | Source |
|-------|--------|
| `ts` | ISO timestamp |
| `actorId` | Stable identifier derived from validated token (see Phase 2 key id, or `"shared"` for legacy single token) |
| `action` | e.g. `system.create`, `system.delete`, `credentials.rotate`, `alerts.update` |
| `resource` | system UUID when applicable |
| `method`, `path` | HTTP metadata |
| `clientIp` | `CF-Connecting-IP` when present |
| `outcome` | `success` / `error` + status code |
| `requestId` | `crypto.randomUUID()` per request for correlation |

**Storage options (pick one at implementation time):**

1. **Workers Logpush / Analytics Engine** — best for ops visibility, no KV write amplification; retention depends on Cloudflare plan.
2. **KV ring buffer** — `audit:<YYYY-MM-DD>` append-only JSON lines, 7–30 day TTL; simple but not ideal for high write volume.

Do **not** log bearer tokens, passwords, webhook URLs, or request bodies containing credentials.

### Phase 2 — Per-user opaque API keys in KV (when multi-user is required)

Replace the single-secret equality check with a **token registry in KV**:

```
token:<sha256(token)> → { id, label, role, createdAt, expiresAt?, revokedAt? }
_index_tokens → [{ id, label, role, prefix, createdAt }]   // no secrets
```

- **Issue tokens** via a Wrangler/admin script or protected `POST /api/admin/tokens` route (guarded by a bootstrap `ADMIN_TOKEN` or Cloudflare Access — see alternatives).
- **Validate** by hashing the presented bearer token and looking up `token:<hash>`; reject revoked/expired entries.
- **Roles (minimal):**
  - `read` — GET routes only (dashboard polling, history, HA bridge).
  - `admin` — all routes including system CRUD and alert config.
- **Frontend unchanged** — still sends `Authorization: Bearer …`; users paste their personal key on the setup screen instead of the household shared secret.
- **Rate limits** continue to key off the bearer string (now per-user).

Use **opaque random tokens** (e.g. 32-byte base64url), not JWTs. There is no token-issuing authority, refresh flow, or browser session server in this stack; JWT adds complexity without benefit for long-lived API keys stored in `localStorage`.

**Migration:** On first deploy with multi-token mode, import the existing `API_TOKEN` as one `admin` registry entry labeled `"legacy-shared"` so existing clients keep working until rotated.

### Phase 3 — Cloudflare Access (optional hardening, not product auth)

Document as an **operator-only** pattern: protect a staging Worker or admin token-minting UI with Cloudflare Zero Trust (Google/email OTP). **Not** recommended as the default end-user auth mechanism because:

- Frontend is often hosted on GitHub Pages or another origin, separate from `*.workers.dev`.
- Mobile deep links (`?proxy=…&token=…`) are a core UX; Access cookie sessions do not compose cleanly with that model without a custom token exchange.
- Homeowners typically lack corporate IdP accounts.

Access remains valuable for **protecting admin surfaces** (token management, Wrangler-adjacent tooling), not for every dashboard poll.

## Consequences

- **Default deployments stay simple** — no new secrets, KV keys, or frontend work for single-user households.
- **Audit without multi-user** is achievable in Phase 1 with ~1–2 days of Worker work; all mutations become attributable to `"shared"` until Phase 2 lands.
- **Multi-user** is an opt-in KV-backed feature; ops cost shifts from one secret rotation to per-user revoke + optional expiry.
- **Security posture improves incrementally** — read-only tokens limit blast radius for HA automations or guest viewers; admin tokens can be rotated independently.
- **PLAN.md §13 Q5 is resolved** — shared token remains the default; per-user keys + mutation audit are the planned upgrade path when needed.

## Alternatives considered

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Single shared token + rotation only** | Already implemented; zero frontend change; matches trust model of off-grid households | No per-user revoke; no actor attribution; one leak = full access | **Keep as Phase 0 default** |
| **Per-user JWT in KV** | Standard claims (`sub`, `exp`, `role`); self-contained validation | Requires signing secret rotation story, clock skew handling, and refresh/reissue UX unnecessary for static SPA + long-lived keys | **Rejected** — opaque KV keys are simpler and equally secure for this use case |
| **Cloudflare Access as primary auth** | SSO/MFA; built-in Zero Trust audit logs | Poor fit for GitHub Pages frontend, URL token bookmarks, and non-corporate users; adds Zero Trust billing/ops | **Optional for admin only**, not primary product auth |
| **Audit every request including polls** | Complete access log | ~1 req/min/client × N systems → noisy, costly, little security value for read-only solar data | **Rejected** — mutation-only audit |
| **Third-party auth (Auth0, Clerk, etc.)** | Full user management UI | New vendor, cost, frontend OAuth redirect flow — violates zero-build-step simplicity | **Out of scope** for this project |

## Implementation scope (estimates)

| Phase | Scope | Effort | Dependencies |
|-------|--------|--------|--------------|
| **0** | Rotation runbook polish in `DEPLOY.md` | **0.5 day** (docs) | None |
| **1** | `auditLog()` helper; hook POST/PUT/DELETE routes; unit tests; optional Logpush/Analytics wiring | **1–2 days** | None |
| **2** | KV token registry; `checkAuth` refactor; `scripts/mint-token.js`; role middleware; migration for legacy `API_TOKEN`; admin route or CLI-only mint | **3–5 days** | Phase 1 recommended first |
| **3** | Access application doc for staging/admin; optional `CF-Access-JWT-Assertion` validation on admin routes | **1–2 days** (mostly ops/docs) | Phase 2 admin surface |

**Frontend work:** none for Phases 0–2 (same bearer header). Optional later: show read-only vs admin hint in manage-systems when backend exposes role via `GET /api/me`.

**Testing:** extend `worker/test/auth.test.js` and `routes.test.js` for role enforcement, revoked tokens, and audit emission on mutations.

## Recommendation summary

| Need | Approach |
|------|----------|
| Single household / trusted family | **Phase 0** — shared `API_TOKEN` |
| "Who deleted my system?" / compliance curiosity | **Phase 1** — mutation audit log |
| Guest viewer, separate maintainer, revoked access | **Phase 2** — per-user opaque keys with `read` / `admin` roles |
| Lock down token minting for ops team | **Phase 3** — Cloudflare Access on admin only |

Implement **Phase 1 when audit is requested**; defer **Phase 2** until a concrete multi-user requirement appears (e.g. read-only token for a neighbor, separate maintainer credential). Do not block current roadmap on multi-user auth.
