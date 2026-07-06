# Solar Proxy Worker — Deployment Runbook

Step-by-step guide for deploying the **solar-proxy** Cloudflare Worker. A new operator can follow this document without reading application source code.

---

## What you are deploying

| Component | Purpose |
|-----------|---------|
| **Worker** (`solar-proxy`) | Token-gated REST API that stores inverter credentials in KV and proxies ShineMonitor / Growatt APIs |
| **Workers KV** (`SYSTEMS` binding) | System configs, encrypted credentials, alert cooldown state |
| **Cron trigger** (optional) | Every 5 minutes — evaluates SOC / generator alerts and POSTs to configured webhooks |
| **Secrets** | `API_TOKEN`, `CREDENTIALS_KEY`, `ALLOWED_ORIGINS` — never committed to git |

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

Secrets are encrypted by Cloudflare and injected at runtime as `env.API_TOKEN`, `env.CREDENTIALS_KEY`, and `env.ALLOWED_ORIGINS`. They are **not** in `wrangler.toml` and are **not** overwritten by `wrangler deploy`.

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
- **Unset** — Worker runs in open dev mode (anyone can call the API). **Never leave production unset.**

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

### 3.4 List / rotate secrets

```bash
# List secret names (not values)
npx wrangler secret list

# Overwrite a secret
openssl rand -base64 32 | npx wrangler secret put API_TOKEN
```

After rotating `API_TOKEN`, update the access token in every frontend client (setup screen or bookmark URL).

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

---

## 7. Production checklist

Use this before pointing users at a new deployment.

| Item | Action | Verify |
|------|--------|--------|
| **API_TOKEN set** | `npx wrangler secret put API_TOKEN` | `GET /api/systems` without token returns **401** |
| **CREDENTIALS_KEY set** | `openssl rand -base64 32 \| wrangler secret put CREDENTIALS_KEY` | Add a test system; KV entry has `_encrypted: true` (Dashboard → KV) |
| **ALLOWED_ORIGINS set** | `wrangler secret put ALLOWED_ORIGINS` | Browser from frontend origin succeeds; random origin gets **403** on preflight |
| **KV bound** | `id` in `wrangler.toml` matches your namespace | `wrangler kv key list --binding SYSTEMS` works |
| **HTTPS only** | Worker URL is `https://` | Frontend also served over HTTPS |
| **Token not in git** | Secrets only via `wrangler secret put` | No tokens in repo, issues, or CI logs |
| **Frontend token** | Same value as `API_TOKEN` in setup / bookmark | Setup screen connects successfully |
| **Alerts (if used)** | `enabled: true` + valid `webhookUrl` per system | Cron Events show success; test webhook receives POST |
| **Health monitoring** | Optional uptime check on `/api/health` | Returns `{ "ok": true }` |

**Dev mode warning:** If `API_TOKEN` is unset, the Worker accepts unauthenticated requests. This is intentional for local development only.

---

## 8. Tag-based deploy via CI

GitHub Actions deploys **production** (Worker + frontend Pages) when you push a semver tag `vMAJOR.MINOR.PATCH` (e.g. `v1.2.0`). Pushes to `main` run tests only.

Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)

| Job | When | What |
|-----|------|------|
| `worker-test` | Every push / PR | `npm ci && npm test` in `worker/` |
| `frontend-test` | Every push / PR | Frontend unit tests |
| `e2e` | Every push / PR | Playwright against mock Worker |
| `release-gate` | Push tag `v*` only | Validates `vMAJOR.MINOR.PATCH` format |
| `deploy-worker` | Valid release tag | `npx wrangler deploy` after tests pass |
| `deploy-frontend` | Valid release tag | `wrangler pages deploy` after tests pass |

### 8.1 One-time GitHub secret

Add under **Repository → Settings → Secrets and variables → Actions**:

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | Authenticates `wrangler deploy` in CI |

Create a [Cloudflare API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) with:

- **Account** — Workers Scripts: **Edit**
- **Account** — Workers KV Storage: **Edit** (for the `SYSTEMS` namespace)
- **Account** — Account Settings: **Read** (optional, for account scoping)

Use a custom token template or “Edit Cloudflare Workers” and ensure KV permissions are included.

### 8.2 Release procedure

```bash
# Ensure main is green in CI
git checkout main
git pull

# Tag and push
git tag v1.2.0
git push origin v1.2.0
```

CI runs tests, then deploys Worker + frontend from the tagged commit. **Runtime secrets are not set by CI** — configure `API_TOKEN`, `CREDENTIALS_KEY`, and `ALLOWED_ORIGINS` once per Cloudflare account with `wrangler secret put` (§3).

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
| **API_TOKEN** | `wrangler secret put API_TOKEN` → update all frontends |
| **CREDENTIALS_KEY** | Generate new key → existing encrypted data needs re-discovery or migration; plan downtime |
| **Inverter password** | Delete system in UI and re-add, or extend Worker with a credential-update route (not built-in today) |

### Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401 Unauthorized` | Wrong or missing Bearer token | Match frontend token to `API_TOKEN` secret |
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
```

`.dev.vars` is gitignored. For production values, always use `wrangler secret put`.

---

## Related documentation

| Document | Description |
|----------|-------------|
| [Root README](../README.md) | Architecture, frontend hosting, API overview |
| [PLAN.md](../PLAN.md) | Roadmap and design decisions |
| [wrangler.toml](./wrangler.toml) | Worker name, KV binding, cron schedule |
| [discovery/](../discovery/) | Vendor API references for debugging adapter issues |
