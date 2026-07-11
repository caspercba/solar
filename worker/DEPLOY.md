# Solar Proxy Worker — Deployment Runbook

Step-by-step guide for deploying the **solar-proxy** Cloudflare Worker. A new operator can follow this document without reading application source code.

---

## What you are deploying

| Component | Purpose |
|-----------|---------|
| **Worker** (`solar-proxy`) | Token-gated REST API that stores inverter credentials in KV and proxies ShineMonitor / Growatt APIs |
| **Workers KV** (`SYSTEMS` binding) | System configs, encrypted credentials, alert cooldown state |
| **Cron trigger** (optional) | Every 5 minutes — evaluates SOC / generator alerts and POSTs to configured webhooks |
| **Analytics Engine** (optional) | Queryable error metrics from adapter and alert failures (`ANALYTICS` binding) |
| **Secrets** | `API_TOKEN`, `PRODUCTION`, `CREDENTIALS_KEY`, `ALLOWED_ORIGINS` — never committed to git |

The static frontend (repository root) is deployed separately — see the root [README](../README.md#host-the-frontend).

---

## Prerequisites

1. **Cloudflare account** with Workers and Workers KV enabled ([sign up](https://dash.cloudflare.com/sign-up)).
2. **Node.js 18+** and npm.
3. **Wrangler CLI** — installed via the worker package (`npm install` in `worker/`).
4. **Repository checkout** on your machine or CI runner.

---

## 1. Authenticate Wrangler

Log in once per machine (or use an API token for CI — see [§8 Tag-based deploy via CI](#8-tag-based-deploy-via-ci)):

```bash
cd worker
npm install
npx wrangler login
```

Wrangler opens a browser window to authorize your Cloudflare account. Confirm the account shown in the terminal matches the account where you want the Worker to live.

**CI / headless:** skip `wrangler login` and set `CLOUDFLARE_API_TOKEN` in the environment instead (see §8).

---

## 2. Create the KV namespace

The Worker stores system configs under the KV binding named `SYSTEMS`.

```bash
cd worker
npx wrangler kv namespace create SYSTEMS
```

Example output:

```text
🌀 Creating namespace with title "solar-proxy-SYSTEMS"
✨ Success!
Add the following to your wrangler.toml:
[[kv_namespaces]]
binding = "SYSTEMS"
id = "abc123def456..."
```

Copy the returned **`id`** into `worker/wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "SYSTEMS"
id = "<paste-your-namespace-id>"
```

**Optional — local preview namespace** (isolated KV for `wrangler dev`):

```bash
npx wrangler kv namespace create SYSTEMS --preview
```

Add a `preview_id` to the same `[[kv_namespaces]]` block if you use preview bindings.

**Verify binding:**

```bash
npx wrangler kv key list --binding SYSTEMS
```

An empty list is expected on first deploy.

---

## 3. Configure Worker secrets

Secrets are encrypted by Cloudflare and injected at runtime as `env.API_TOKEN`, `env.PRODUCTION`, `env.CREDENTIALS_KEY`, and `env.ALLOWED_ORIGINS`. They are **not** in `wrangler.toml` and are **not** overwritten by `wrangler deploy`.

Run each command from the `worker/` directory. Wrangler prompts for the value (paste or pipe stdin).

### 3.1 `API_TOKEN` (required in production)

Shared bearer token the frontend sends as `Authorization: Bearer <token>`.

Generate a strong random value:

```bash
openssl rand -base64 32 | npx wrangler secret put API_TOKEN
```

Or enter manually:

```bash
npx wrangler secret put API_TOKEN
```

**Behavior:**

- **Set** — all `/api/*` routes except `GET /api/health` require a matching Bearer token.
- **Unset, `PRODUCTION` not set** — Worker runs in open dev mode (anyone can call the API). Intended for local `wrangler dev` and unit tests only.
- **Unset, `PRODUCTION` set** — see §3.2a. All `/api/*` routes except `GET /api/health` return `503` instead of running open.

### 3.1a `PRODUCTION` (required on every real deployment)

Fail-closed guard that prevents a deployed Worker from silently running in open dev mode if `API_TOKEN` was never set (e.g. forgotten secret, wrong Cloudflare account, botched migration).

```bash
echo "true" | npx wrangler secret put PRODUCTION
echo "true" | npx wrangler secret put PRODUCTION --env staging
```

**Behavior:**

- **`PRODUCTION=true` and `API_TOKEN` set** — normal Bearer-token auth (§3.1).
- **`PRODUCTION=true` and `API_TOKEN` unset** — every route except `GET /api/health` returns `503 { "error": "Service misconfigured: API_TOKEN is required in this environment" }`. The Worker never falls back to open mode.
- **`PRODUCTION` unset** — no change to existing behavior; `wrangler dev` and unit tests keep working with `API_TOKEN` unset. Since `PRODUCTION` is a secret (not a `wrangler.toml` var), it is never present locally unless you deliberately add it to `.dev.vars`.

Set this on **both** production and staging — anything that isn't your local machine.

### 3.2 `CREDENTIALS_KEY` (required in production)

AES-256-GCM key for encrypting inverter portal passwords in KV.

Generate and store in one step:

```bash
openssl rand -base64 32 | npx wrangler secret put CREDENTIALS_KEY
```

**Behavior:**

- **Set** — new and updated systems store encrypted credentials; plaintext entries are re-encrypted on next read.
- **Unset** — credentials stored in KV as plaintext (local dev only).

**Important:** Back up this key securely. Losing `CREDENTIALS_KEY` makes existing encrypted credentials unreadable. Rotating the key requires re-adding systems unless you implement a migration.

### 3.3 `ALLOWED_ORIGINS` (required in production)

Comma-separated list of frontend origins allowed for CORS (scheme + host, no trailing slash).

```bash
npx wrangler secret put ALLOWED_ORIGINS
```

Example value:

```text
https://your-user.github.io,https://solar-dashboard.pages.dev
```

**Behavior:**

- **Set** — browser requests from listed origins receive CORS headers; others get `403`.
- **Unset** — dev mode reflects the request `Origin` (or `*`), suitable for local testing only.

### 3.4 List secrets

```bash
# List secret names (not values)
npx wrangler secret list
```

To rotate `API_TOKEN`, follow the runbook in [§3.5](#35-api_token-rotation-runbook). For guidance on shared vs per-user tokens, see [§3.6](#36-shared-token-vs-per-user-keys).

### 3.5 API_TOKEN rotation runbook

Rotate the shared bearer token when you suspect a leak, a trusted person no longer needs access, or on a routine schedule (e.g. annually). The Worker stores **one** `API_TOKEN` value — `wrangler secret put` replaces it immediately, so the previous token stops working as soon as the new secret is deployed. Plan client updates before you rotate if multiple people or devices use the dashboard.

**Decision context:** This is [ADR 0002 Phase 0](../docs/decisions/0002-multi-user-token-and-audit-log.md) — the default model for households and trusted small groups. See [§3.6](#36-shared-token-vs-per-user-keys) when you need per-user revoke instead of rotating for everyone.

#### Step 1 — Generate a new token

On a trusted machine, generate a strong random value and save it in a password manager until clients are updated (do not commit or paste into chat):

```bash
openssl rand -base64 32
```

Copy the output — you will need it for `wrangler secret put` and for each frontend client.

#### Step 2 — Deploy the secret

From `worker/`, overwrite the Worker secret with the **same** value from Step 1. Wrangler prompts for the value — paste it when asked:

```bash
cd worker
npx wrangler secret put API_TOKEN
```

Or pipe stdin without echoing the token to the shell history (set `NEW_TOKEN` from your password manager):

```bash
printf '%s' "$NEW_TOKEN" | npx wrangler secret put API_TOKEN
```

**Staging first (recommended):** rotate on staging, verify clients against the staging Worker URL, then repeat for production:

```bash
npx wrangler secret put API_TOKEN --env staging
# ... verify (Step 4) against staging URL ...
npx wrangler secret put API_TOKEN
```

No `wrangler deploy` is required — secret updates take effect on the next request to the live Worker.

#### Step 3 — Update every client

Update the access token everywhere it is stored. Missing one client causes `401 Unauthorized` until fixed.

| Client | Where to update |
|--------|-----------------|
| **Dashboard setup screen** | Open the app → settings / setup → paste new token → save (writes `localStorage`) |
| **Home-screen bookmark** | Replace `token=` in the URL query string, or recreate the bookmark from setup |
| **Home Assistant / scripts** | Update REST sensor or automation headers (`Authorization: Bearer …`) |
| **curl / Postman / ops notes** | Replace stored token in shell history, password manager, or runbooks |

Bookmark format (trusted devices only — token is visible in the URL):

```text
https://your-frontend.example/?proxy=https://solar-proxy.example.workers.dev&token=NEW_API_TOKEN
```

**Tip:** If several family members use separate phones, coordinate so everyone updates within the same window right after Step 2.

#### Step 4 — Verify

Confirm the new token works and the old token is rejected:

```bash
PROXY="https://solar-proxy.<subdomain>.workers.dev"
NEW_TOKEN="<paste-new-token>"
OLD_TOKEN="<paste-old-token-if-still-available>"

# New token — expect 200 and JSON (empty array or system list)
curl -sS -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $NEW_TOKEN" \
  "$PROXY/api/systems"
# Expected: 200

# Old token — expect 401
curl -sS -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $OLD_TOKEN" \
  "$PROXY/api/systems"
# Expected: 401

# Health still open without auth
curl -sS "$PROXY/api/health"
# Expected: {"ok":true,"version":"..."}
```

Also open the frontend on a phone or desktop: connection status dot should be green and realtime data should load.

#### Step 5 — Retire the old token

There is no separate “disable old token” step — Cloudflare keeps only the latest `API_TOKEN` value. After Step 2:

1. **Delete** the old token from password managers, bookmarks, HA config, and any shared notes.
2. **Do not** store the new token in git, screenshots, or CI logs.
3. If rotation was triggered by a suspected leak, assume the old token was compromised; no further Worker action is needed once clients use the new value.

**Rollback:** If clients break after a bad rotation, run `npx wrangler secret put API_TOKEN` again with the previous value (only if you still have it). There is no secret version history in the dashboard.

#### Rotation checklist

| Step | Action | Done |
|------|--------|------|
| 1 | Generate new random token; store securely | ☐ |
| 2 | `wrangler secret put API_TOKEN` (staging first if used) | ☐ |
| 3 | Update setup screen, bookmarks, HA, scripts | ☐ |
| 4 | `curl` / UI verify new token 200, old token 401 | ☐ |
| 5 | Delete old token from all stores | ☐ |

### 3.6 Shared token vs per-user keys

The Worker ships with a **single shared `API_TOKEN`** (ADR 0002 Phase 0). That is the right default for most deployments.

| Scenario | Recommended approach |
|----------|---------------------|
| One household; family members all trust each other | **Shared token** — rotate via [§3.5](#35-api_token-rotation-runbook) when someone leaves or on a schedule |
| Home Assistant or one automation using the API | **Shared token** — same bearer on read-only polls |
| “Who deleted my system?” / compliance attribution | **Phase 1** — mutation-only audit log ([ADR 0002](../docs/decisions/0002-multi-user-token-and-audit-log.md#phase-1--mutation-audit-log-recommended-next-step-if-audit-is-the-driver)); implemented — structured `audit` JSON lines via `auditLog()` in `worker/src/logger.js` on `POST /api/systems`, `PUT /api/systems/:id/credentials`, `PUT /api/systems/:id/alerts`, `DELETE /api/systems/:id`, `POST /api/admin/tokens`, `DELETE /api/admin/tokens/:id`; `actorId` is `"shared"` for the legacy token or the token's own `id` for per-user keys |
| Guest viewer, separate maintainer, or revoke one person without affecting others | **Phase 2** — per-user opaque API keys in KV with `read` / `admin` roles ([ADR 0002](../docs/decisions/0002-multi-user-token-and-audit-log.md#phase-2--per-user-opaque-api-keys-in-kv-when-multi-user-is-required)); **implemented** — see §3.6.1 |
| Lock down token minting for an ops team | **Phase 3** — optional Cloudflare Access on admin surfaces only ([ADR 0002](../docs/decisions/0002-multi-user-token-and-audit-log.md#phase-3--cloudflare-access-optional-hardening-not-product-auth)) |

**Shared token limitation:** Rotating or revoking access affects **every** client using that token. Per-user keys (§3.6.1) solve this without extra Worker deployments.

Full decision record, alternatives considered, and implementation phases: **[docs/decisions/0002-multi-user-token-and-audit-log.md](../docs/decisions/0002-multi-user-token-and-audit-log.md)**.

#### 3.6.1 Per-user API keys (ADR 0002 Phase 2)

Per-user keys are **opaque random tokens** (32 bytes, base64url) stored hashed (SHA-256) in the `SYSTEMS` KV namespace alongside system configs. They are additive: the legacy `API_TOKEN` secret keeps working unchanged (checked first, with no KV read, and always resolves to the `"shared"` identity with the `admin` role) — **there is no migration step**.

**Roles:**

- `read` — GET routes only (dashboard polling, history, HA bridge, listing systems).
- `admin` — all routes, including system CRUD, alert/grid-detect config, and minting/revoking other tokens.

**Minting requires an existing admin-role token** (the legacy `API_TOKEN` or another minted `admin` key) — there is no separate bootstrap secret.

```bash
PROXY="https://solar-proxy.<subdomain>.workers.dev"
TOKEN="YOUR_API_TOKEN"

# Mint a read-only key for a guest or Home Assistant automation
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label": "guest-phone", "role": "read"}' \
  "$PROXY/api/admin/tokens"
# Response includes "token" — shown once, save it now:
# { "id": "...", "token": "...", "label": "guest-phone", "role": "read", "createdAt": "...", "expiresAt": null }
```

Optional `expiresAt` (ISO 8601 string) auto-expires the key without a manual revoke.

```bash
# List minted keys (never returns the plaintext token or its hash)
curl -sS -H "Authorization: Bearer $TOKEN" "$PROXY/api/admin/tokens"

# Revoke one key by id — every other key (including the legacy shared token) keeps working
curl -sS -X DELETE -H "Authorization: Bearer $TOKEN" "$PROXY/api/admin/tokens/<id>"
```

**Frontend:** unchanged — paste the minted token into the setup screen's Access Token field instead of the shared `API_TOKEN`.

**Rate limiting:** each bearer token (legacy or per-user) is limited independently (§ `worker/src/rateLimit.js`).

---

## 4. Deploy the Worker

```bash
cd worker
npx wrangler deploy
```

Note the deployed URL, e.g. `https://solar-proxy.<subdomain>.workers.dev`.

### Post-deploy smoke test

**Health (no auth):**

```bash
curl -sS "https://solar-proxy.<subdomain>.workers.dev/api/health"
# Expected: {"ok":true,"version":"1.1.0"}
```

**Auth gate:**

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  "https://solar-proxy.<subdomain>.workers.dev/api/systems"
# Expected: 401 without Bearer token

curl -sS -H "Authorization: Bearer YOUR_API_TOKEN" \
  "https://solar-proxy.<subdomain>.workers.dev/api/systems"
# Expected: [] or JSON array of systems
```

If `401` came back **without** a Bearer token above, the deployment is auth-gated correctly. If you ever see a `200`/JSON array there instead, `PRODUCTION` and/or `API_TOKEN` are missing on this deployment — fix immediately (§3.1, §3.1a).

**CORS (from allowed origin):**

```bash
curl -sS -I -H "Origin: https://your-frontend.example" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  "https://solar-proxy.<subdomain>.workers.dev/api/systems"
# Expected: Access-Control-Allow-Origin: https://your-frontend.example
```

---

## 5. Connect the frontend

1. Host the static files from the repository root (GitHub Pages, Cloudflare Pages, or local server — see root README).
2. Open the frontend setup screen.
3. Enter:
   - **Proxy URL** — Worker URL with no trailing slash.
   - **Access Token** — same value as `API_TOKEN`.
4. Add inverter systems via the UI (Worker runs discovery and writes to KV).

Bookmark auto-connect (trusted devices only):

```text
https://your-frontend.example/?proxy=https://solar-proxy.example.workers.dev&token=YOUR_API_TOKEN
```

---

## 6. Optional — alert webhooks

Alerts are **disabled by default**. The Worker cron (every 5 minutes) polls systems with alerts enabled and POSTs JSON to a webhook when:

- Battery SOC drops below `lowSocThreshold` (with cooldown), or
- Generator / grid input becomes active (`grid.active`).

### 6.1 Cron configuration

Cron is defined in `wrangler.toml`:

```toml
[triggers]
crons = ["*/5 * * * *"]
```

Deploying with this file registers the schedule on Cloudflare. Removing the `[triggers]` block on a future deploy clears cron triggers.

### 6.2 Enable alerts per system

After at least one system exists, configure alerts via the API (requires Bearer token):

```bash
SYSTEM_ID="<uuid-from-GET-/api/systems>"
PROXY="https://solar-proxy.<subdomain>.workers.dev"
TOKEN="YOUR_API_TOKEN"

curl -sS -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "webhookUrl": "https://hooks.example.com/your-secret-path",
    "lowSocThreshold": 20,
    "notifyLowSoc": true,
    "notifyGenerator": true,
    "cooldownMinutes": 60
  }' \
  "$PROXY/api/systems/$SYSTEM_ID/alerts"
```

**Webhook payload** (compatible with Slack-style `{ "text": "..." }` and Discord `{ "content": "..." }`):

```json
{
  "text": "[Solar Dashboard] Low battery: Cabin — SOC 18% (47.2 V) at ...",
  "content": "...",
  "alertType": "low_soc",
  "system": { "id": "...", "name": "Cabin", "service": "growatt" },
  "battery": { "soc": 18, "voltage": 47.2 },
  "grid": { "active": false },
  "timestamp": "2026-07-03 14:00:00"
}
```

**Read current settings:**

```bash
curl -sS -H "Authorization: Bearer $TOKEN" \
  "$PROXY/api/systems/$SYSTEM_ID/alerts"
```

Alert cooldown state is stored in KV as `alert-state:<systemId>`.

### 6.3 Test cron locally

Start dev server with scheduled-handler testing enabled:

```bash
cd worker
npx wrangler dev --test-scheduled
```

In another terminal, trigger the scheduled handler (default port `8787`):

```bash
# Wrangler 4 — recommended
curl -sS "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*&format=json"

# Alternative endpoint (some Wrangler versions)
curl -sS "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```

With alerts enabled and a reachable webhook, check webhook logs after triggering. Worker logs appear in the `wrangler dev` terminal.

**Production cron verification:** Cloudflare Dashboard → **Workers & Pages** → **solar-proxy** → **Triggers** → confirm cron `*/5 * * * *` and inspect **Cron Events** for success/failure after a few minutes.

### 6.4 Optional — Workers Analytics Engine (error metrics)

The Worker emits **structured JSON logs** for adapter failures (502 responses), alert fetch failures, and webhook delivery errors. When an Analytics Engine dataset is bound, those same events are also written as queryable data points — no code changes or secrets required beyond the binding in `wrangler.toml`.

**What gets recorded:** adapter discover/fetch/history errors and alert cron failures. Each data point includes:

| Field | Content |
|-------|---------|
| `event` | e.g. `adapter_fetch_failed`, `alert_webhook_failed` |
| `service` | `shinemonitor` or `growatt` |
| `systemId` | Configured system UUID (when known) |
| `route` | HTTP route or `scheduled/alerts` |
| `message` | Redacted error summary (no credentials or webhook URLs) |

**Local dev:** the binding is omitted from Miniflare/Vitest — logging goes to console only; `recordObservability` is a no-op.

#### 6.4.1 Create datasets (one-time)

1. Cloudflare Dashboard → **Workers & Pages** → **Analytics Engine** → **Create dataset**.
2. Create **`solar_proxy_errors`** for production.
3. (Optional) Create **`solar_proxy_errors_staging`** for the staging Worker.

Dataset names must match `wrangler.toml`:

```toml
# Production (default deploy)
[[analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "solar_proxy_errors"

# Staging (wrangler deploy --env staging)
[[env.staging.analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "solar_proxy_errors_staging"
```

#### 6.4.2 Deploy with binding

After the dataset exists, deploy as usual:

```bash
cd worker
npx wrangler deploy              # production
npx wrangler deploy --env staging   # staging
```

Wrangler registers the `ANALYTICS` binding automatically — no `wrangler secret put` step.

#### 6.4.3 Query and verify

**Dashboard:** **Workers & Pages** → **Analytics Engine** → select the dataset → explore recent writes.

**SQL (Workers Analytics SQL API):** example — error count by event in the last hour:

```sql
SELECT
  blob1 AS event,
  blob2 AS service,
  COUNT(*) AS errors
FROM solar_proxy_errors
WHERE timestamp > NOW() - INTERVAL '1' HOUR
  AND double1 = 1
GROUP BY event, service
ORDER BY errors DESC
```

**Smoke test:** trigger a known 502 (e.g. bad inverter credentials on discovery) and confirm a row appears within a few minutes:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"service":"growatt","user":"bad","password":"bad"}' \
  "$PROXY/api/systems"
# Expected: 502; check dataset for event adapter_discover_failed
```

**Console logs** remain the primary debug path (`npx wrangler tail`). Analytics Engine complements logs with aggregations (error rates by system, service, route). See root [README § Observability](../README.md#observability) for Logpush and third-party APM options.

---

## 7. Production checklist

Use this before pointing users at a new deployment.

| Item | Action | Verify |
|------|--------|--------|
| **API_TOKEN set** | `npx wrangler secret put API_TOKEN` | `GET /api/systems` without token returns **401** |
| **PRODUCTION set** | `echo "true" \| npx wrangler secret put PRODUCTION` | Temporarily unset `API_TOKEN` (redeploy, test, then restore) — `GET /api/systems` should return **503**, never open access |
| **CREDENTIALS_KEY set** | `openssl rand -base64 32 \| wrangler secret put CREDENTIALS_KEY` | Add a test system; KV entry has `_encrypted: true` (Dashboard → KV) |
| **ALLOWED_ORIGINS set** | `wrangler secret put ALLOWED_ORIGINS` | Browser from frontend origin succeeds; random origin gets **403** on preflight |
| **KV bound** | `id` in `wrangler.toml` matches your namespace | `wrangler kv key list --binding SYSTEMS` works |
| **HTTPS only** | Worker URL is `https://` | Frontend also served over HTTPS |
| **Token not in git** | Secrets only via `wrangler secret put` | No tokens in repo, issues, or CI logs |
| **Frontend token** | Same value as `API_TOKEN` in setup / bookmark | Setup screen connects successfully |
| **Alerts (if used)** | `enabled: true` + valid `webhookUrl` per system | Cron Events show success; test webhook receives POST |
| **Analytics Engine (optional)** | Create `solar_proxy_errors` dataset; binding in `wrangler.toml` | Trigger a 502; row appears in dataset with redacted message |
| **Health monitoring** | Optional uptime check on `/api/health` | Returns `{ "ok": true }` |

**Dev mode warning:** If `API_TOKEN` is unset **and** `PRODUCTION` is unset, the Worker accepts unauthenticated requests. This is intentional for local development only — always set `PRODUCTION=true` (§3.1a) on deployed Workers so a missing `API_TOKEN` fails closed (`503`) instead of running open.

---

## 8. CI deploy policy

GitHub Actions deploys the **frontend** to Cloudflare Pages on every push to `main`, and the **production Worker** when you push a semver tag `vMAJOR.MINOR.PATCH` (e.g. `v1.2.0`).

Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)

| Job | When | What |
|-----|------|------|
| `worker-test` | Every push / PR | `npm ci && npm test` in `worker/` |
| `frontend-test` | Every push / PR | Frontend unit tests |
| `e2e` | Every push / PR | Playwright against mock Worker |
| `release-gate` | Push tag `v*` only | Validates `vMAJOR.MINOR.PATCH` format |
| `deploy-frontend` | Push to `main` | `scripts/stage-frontend.sh` → `wrangler pages deploy` after tests pass |
| `deploy-worker` | Valid release tag | `npx wrangler deploy` after tests pass |

### 8.1 One-time GitHub secrets

Add under **Repository → Settings → Secrets and variables → Actions**:

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | Authenticates `wrangler deploy` in CI |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID (Dashboard → Workers & Pages → right sidebar); required for Pages deploy and some Wrangler commands |

Create a [Cloudflare API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) with:

- **Account** — Workers Scripts: **Edit**
- **Account** — Workers KV Storage: **Edit** (for the `SYSTEMS` namespace)
- **Account** — Cloudflare Pages: **Edit** (frontend deploy on release tags)
- **Account** — Account Settings: **Read** (optional, for account scoping)

Use a custom token template or “Edit Cloudflare Workers” and ensure KV and Pages permissions are included.

### 8.2 Release procedure

```bash
# Ensure main is green in CI
git checkout main
git pull

# Tag and push
git tag v1.2.0
git push origin v1.2.0
```

CI runs tests, then deploys the production Worker from the tagged commit. The frontend is deployed separately on each push to `main`. **Runtime secrets are not set by CI** — configure `API_TOKEN`, `PRODUCTION`, `CREDENTIALS_KEY`, and `ALLOWED_ORIGINS` once per Cloudflare account with `wrangler secret put` (§3).

### 8.3 Manual deploy (without CI)

```bash
cd worker
npm ci
npm test          # optional but recommended
npx wrangler deploy
```

Requires `wrangler login` or `CLOUDFLARE_API_TOKEN` in the environment.

---

## 9. Operations reference

### KV keys

| Key | Content |
|-----|---------|
| `_index` | JSON array `[{ id, name, service }, ...]` |
| `system:<uuid>` | Full system config including encrypted `credentials` and optional `alerts` |
| `alert-state:<uuid>` | Alert cooldown / breach state |
| `token:<sha256-hex>` | Per-user API key registry entry: `{ id, label, role, createdAt, expiresAt, revokedAt }` (ADR 0002 Phase 2) |
| `token-id:<uuid>` | Maps a token `id` to its hash, for revoke-by-id lookups |
| `_index_tokens` | JSON array of minted key metadata (no secrets): `[{ id, label, role, prefix, createdAt, expiresAt, revokedAt }, ...]` |

### Useful commands

```bash
# Tail live logs (production)
npx wrangler tail

# List systems index
npx wrangler kv key get --binding SYSTEMS "_index"

# Delete a system key manually (prefer DELETE /api/systems/:id)
npx wrangler kv key delete --binding SYSTEMS "system:<uuid>"

# Show deployed Worker info
npx wrangler deployments list
```

### Rotating credentials

| Secret | Steps |
|--------|-------|
| **API_TOKEN** | Full runbook: [§3.5 API_TOKEN rotation](#35-api_token-rotation-runbook). Shared vs per-user keys: [§3.6](#36-shared-token-vs-per-user-keys) and [ADR 0002](../docs/decisions/0002-multi-user-token-and-audit-log.md). |
| **PRODUCTION** | `echo "true" \| wrangler secret put PRODUCTION` once per deployed environment (production and staging); never set locally |
| **CREDENTIALS_KEY** | Generate new key → existing encrypted data needs re-discovery or migration; plan downtime |
| **Inverter password** | Delete system in UI and re-add, or extend Worker with a credential-update route (not built-in today) |

### Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401 Unauthorized` | Wrong or missing Bearer token | Match frontend token to `API_TOKEN` secret |
| `503 Service misconfigured` | `PRODUCTION=true` but `API_TOKEN` unset | `npx wrangler secret put API_TOKEN` on that environment |
| CORS error in browser | Origin not in `ALLOWED_ORIGINS` | Add exact frontend URL (including `https://`) |
| `CREDENTIALS_KEY required to decrypt` | Key removed after encrypting | Restore key or delete and re-add systems |
| `502 Discovery failed` | Bad inverter credentials or vendor outage | Check credentials; test vendor portal directly |
| Cron never fires | `[triggers]` missing or deploy failed | Redeploy; check Dashboard → Triggers |
| Alerts not sent | `enabled: false`, empty webhook, or cooldown | `GET /api/systems/:id/alerts`; check webhook URL |
| Empty `/api/systems` | Fresh KV or wrong namespace `id` | Verify `wrangler.toml` namespace id |

---

## 10. Local development summary

```bash
cd worker
npm install
npm run dev                    # wrangler dev — open mode if secrets unset
npm test                       # Vitest + Miniflare

# With local secrets (optional — use .dev.vars, never commit):
# echo 'API_TOKEN=dev-token' >> .dev.vars
# echo 'ALLOWED_ORIGINS=http://localhost:8080' >> .dev.vars

# Do NOT add PRODUCTION to .dev.vars — it disables open dev mode (§3.1a) and
# makes `wrangler dev` return 503 unless you also set a local API_TOKEN.
```

`.dev.vars` is gitignored. For production values, always use `wrangler secret put`.

---

## Related documentation

| Document | Description |
|----------|-------------|
| [Root README](../README.md) | Architecture, frontend hosting, API overview |
| [PLAN.md](../PLAN.md) | Roadmap and design decisions |
| [ADR 0002 — Multi-user token and audit log](../docs/decisions/0002-multi-user-token-and-audit-log.md) | Shared token default, rotation (Phase 0), audit log and per-user keys roadmap |
| [wrangler.toml](./wrangler.toml) | Worker name, KV binding, cron schedule |
| [discovery/](../discovery/) | Vendor API references for debugging adapter issues |
