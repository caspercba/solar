# Solar Dashboard

A lightweight, real-time solar monitoring dashboard for off-grid and hybrid inverter systems. The frontend is a static single-page app; a Cloudflare Worker proxy handles authentication, stores system credentials, and normalizes data from vendor APIs (ShineMonitor, Growatt) into one common format.

## Architecture

```mermaid
flowchart LR
  Browser["Static frontend\n(index.html, app.js)"]
  Worker["Cloudflare Worker\n(solar-proxy)"]
  KV["Workers KV\n(system configs)"]
  SM["ShineMonitor API\nweb.shinemonitor.com"]
  GW["Growatt API\nmqtt.growatt.com"]

  Browser -->|"Bearer token\n/api/*"| Worker
  Worker --> KV
  Worker --> SM
  Worker --> GW
```

| Layer | Role |
|-------|------|
| **Frontend** | Dashboard UI — cards, energy-flow, and chart views; 60 s polling; multi-system tabs. Stores proxy URL + access token in `localStorage`. |
| **Worker** | Token-gated REST API. Discovers plants/devices on setup, caches vendor sessions in memory, returns normalized JSON. History routes proxy vendor APIs on demand. |
| **KV** | System configs (`system:<id>`), credentials index (`_index`), and optional alert state (`alert-state:<uuid>`). No historical readings are stored. |
| **Vendor APIs** | ShineMonitor (signed GET) and Growatt (cookie session POST). Neither is callable directly from the browser due to CORS and auth complexity. |

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (Workers + KV)
- [Node.js](https://nodejs.org/) 18+ (for Wrangler)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) — installed via the worker package (see below)

## Deploy the Worker

1. **Install dependencies**

   ```bash
   cd worker
   npm install
   ```

2. **Create a KV namespace** (first-time only)

   ```bash
   npx wrangler kv namespace create SYSTEMS
   ```

   Copy the returned `id` into `worker/wrangler.toml`:

   ```toml
   [[kv_namespaces]]
   binding = "SYSTEMS"
   id = "<your-namespace-id>"
   ```

3. **Set the shared access token** (required for production)

   ```bash
   npx wrangler secret put API_TOKEN
   ```

   Choose a long random string. The frontend sends this as `Authorization: Bearer <token>`. **Never commit the token to git.**

4. **Deploy**

   ```bash
   npx wrangler deploy
   ```

   Note the Worker URL (e.g. `https://solar-proxy.<account>.workers.dev`).

5. **Local development** (optional)

   ```bash
   npm run dev
   ```

   If `API_TOKEN` is not set, the Worker runs in open mode (no auth) — useful for local testing only.

### Historical data (vendor APIs)

Charts and multi-day summaries fetch **live from inverter cloud APIs** on each request. The Worker does not archive historical readings in KV — vendor portals are the source of truth.

| Route | Behavior |
|-------|----------|
| `GET /api/systems/:id/history?date=` | Intraday power series (solar, load, battery). Dispatches to the service adapter's `fetchHistory()` for the requested date (defaults to today in plant-local time). |
| `GET /api/systems/:id/history/summary?days=7` | Daily energy totals and SOC extrema for bar charts. Dispatches to `fetchHistorySummary()` (default 7 days, max 90). |

**Vendor limitations** — If the inverter account is offline, credentials expired, or the vendor API returns no rows for a date, the chart view shows an empty or partial series. There is no Worker-side backfill; missing days are omitted from summaries until the vendor provides data.

**ShineMonitor yesterday fallback** — For realtime `fetchData` and intraday `fetchHistory` when no explicit `date` is given, if today's device data is not yet available the adapter retries with yesterday's date (plant timezone). This covers the common gap before the vendor publishes the current day's series.

Multi-day summaries may require one vendor round-trip per day (e.g. ShineMonitor aggregates from daily `fetchHistory` calls). Use a reasonable `days` value to avoid rate limits.

### Run tests locally

**Worker** (Vitest + Miniflare):

```bash
cd worker
npm install
npm test
```

Tests use [Vitest](https://vitest.dev/) with `@cloudflare/vitest-pool-workers`.

**Frontend helpers** (Vitest + happy-dom, pure functions in `frontend/lib.js`):

```bash
cd frontend
npm install
npm test
```

## CI/CD

GitHub Actions runs on every push to `main` and on pull requests (`.github/workflows/ci.yml`):

1. **Test** — worker unit tests, frontend unit tests, and Playwright E2E.
2. **Deploy frontend** — on push to `main`, stages static assets and publishes to [Cloudflare Pages](https://developers.cloudflare.com/pages/) at **https://solar-dashboard.pages.dev** (production).
3. **Deploy Worker** — when you push a version tag matching `v*` (e.g. `v1.2.0`), deploys the Worker with `wrangler deploy` after worker tests pass.

### Required GitHub secrets

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | Authenticates Wrangler for Worker deploy (tags) and Pages deploy (`main`). Create a [Cloudflare API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) with **Edit Cloudflare Workers** (and KV read/write for the `SYSTEMS` namespace) plus **Cloudflare Pages — Edit**. |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID (Dashboard → Workers & Pages → right sidebar). Required for Pages deploy. |

Add secrets under **Repository → Settings → Secrets and variables → Actions → New repository secret**.

Worker deploy is skipped on PRs and non-tag pushes. Frontend deploy runs only on pushes to `main` (after all test jobs pass). To release a Worker version:

```bash
git tag v1.2.0
git push origin v1.2.0
```

Runtime Worker secrets (`API_TOKEN`, `ALLOWED_ORIGINS`, `CREDENTIALS_KEY`) are **not** set by CI — configure those once with `wrangler secret put` on your Cloudflare account.

## Host the Frontend

The frontend is static — no build step. Serve `index.html`, `app.js`, `style.css`, `manifest.json`, `sw.js`, and `icons/` from the repository root.

### Cloudflare Pages (recommended)

**Production URL:** https://solar-dashboard.pages.dev

Pushes to `main` deploy automatically via GitHub Actions (see [CI/CD](#cicd) above). The workflow runs `scripts/stage-frontend.sh` to copy only static assets into `dist/`, then `wrangler pages deploy`.

**One-time setup** (if not already configured):

1. Add GitHub secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (see table above).
2. Push to `main` — the first deploy creates the `solar-dashboard` Pages project if it does not exist.
3. Configure Worker CORS (below) so the browser can call the proxy from the Pages origin.

**Manual deploy** (optional):

```bash
bash scripts/stage-frontend.sh dist
npx wrangler pages deploy dist --project-name=solar-dashboard
```

**Alternative — connect Git in the Cloudflare dashboard:** Workers & Pages → Create → Pages → Connect to Git → select this repo. Build command: *(none)* · Build output directory: `/` · Root directory: `/`. Disable the dashboard auto-deploy if you rely on the GitHub Action above to avoid duplicate deployments.

### CORS (Worker ↔ frontend)

Browsers block cross-origin API calls unless the Worker returns matching `Access-Control-Allow-Origin` headers. Set the frontend origin(s) on the Worker:

```bash
cd worker
npx wrangler secret put ALLOWED_ORIGINS
```

Enter a comma-separated list, for example:

```
https://solar-dashboard.pages.dev,https://your-custom-domain.com
```

Include every origin users open in the browser (production Pages URL, custom domain, local dev). When `ALLOWED_ORIGINS` is unset, the Worker reflects any request origin (dev mode only — do not use in production).

After updating `ALLOWED_ORIGINS`, no Worker redeploy is required; secrets take effect immediately.

The setup screen default **Proxy URL** (`https://solar-proxy.gaspar-solar.workers.dev`) is independent of where the frontend is hosted — it always points at the Cloudflare Worker API.

### GitHub Pages

1. Push the repo to GitHub.
2. **Settings → Pages → Build and deployment**: source = `Deploy from a branch`, branch = `main` (or your default), folder = `/ (root)`.
3. Add your GitHub Pages URL to `ALLOWED_ORIGINS` on the Worker (same command as above).
4. Open the published URL and complete [first-time setup](#first-time-setup).

### Local

From the repository root:

```bash
python3 -m http.server 8080
# or: npx serve .
```

Open `http://localhost:8080`. Add `http://localhost:8080` to `ALLOWED_ORIGINS` if the Worker secret is set, or leave `ALLOWED_ORIGINS` unset for local dev.

## First-Time Setup

1. **Deploy the Worker** and set `API_TOKEN` (above).
2. **Open the frontend** at https://solar-dashboard.pages.dev (or GitHub Pages / local).
3. On the setup screen, enter:
   - **Proxy URL** — your Worker URL, no trailing slash (e.g. `https://solar-proxy.example.workers.dev`)
   - **Access Token** — the same value you set with `wrangler secret put API_TOKEN`
4. Click **Connect**. The app validates the token against `GET /api/systems`.
5. **Add a system** — choose service (ShineMonitor or Growatt), display name (optional), and inverter portal username/password. The Worker runs discovery (plant, device, nominal power) and stores credentials in KV.
6. The dashboard polls `GET /api/systems/:id/data` every 60 seconds.

**Bookmark auto-connect:** append query parameters to skip the setup form:

```
https://your-frontend.example/?proxy=https://solar-proxy.example.workers.dev&token=YOUR_TOKEN
```

Use only on trusted devices — the token appears in the URL and browser history.

## Worker API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check — returns `{ ok, version }` (no auth required) |
| `GET` | `/api/services` | Supported inverter types |
| `GET` | `/api/systems` | List systems (no credentials) |
| `POST` | `/api/systems` | Add system (`service`, `user`, `password`, optional `name`) |
| `DELETE` | `/api/systems/:id` | Remove a system |
| `GET` | `/api/systems/:id/data` | Normalized real-time data for one system |
| `GET` | `/api/systems/all/data` | Data for all systems |
| `GET` | `/api/systems/:id/history?date=` | Intraday power series (vendor fetch on demand) |
| `GET` | `/api/systems/:id/history/summary?days=7` | Daily energy totals for bar chart (vendor fetch on demand) |

All routes require `Authorization: Bearer <API_TOKEN>` when the secret is configured.

**Rate limits:** Real-time data routes (`GET /api/systems/:id/data` and `GET /api/systems/all/data`) are limited to **60 requests per minute per bearer token** (in-memory per Worker isolate). Exceeding the limit returns **429 Too Many Requests** with a `Retry-After` header (seconds until the window resets). Normal dashboard polling at 60 s intervals is well below this limit. Rate limiting is disabled when `API_TOKEN` is unset (dev open mode).

## Normalized Data Contract

Both adapters return the same shape from `GET /api/systems/:id/data`:

```json
{
  "systemId": "uuid",
  "name": "Plant display name",
  "service": "shinemonitor | growatt",
  "timestamp": "2026-04-04 18:19:48",
  "battery": {
    "voltage": 51.6,
    "soc": 72,
    "current": -62,
    "power": -3200
  },
  "solar": {
    "power": 110,
    "voltage": 245.8
  },
  "load": {
    "power": 283,
    "percent": 5
  },
  "grid": {
    "power": 0,
    "voltage": 0,
    "active": false
  },
  "inverter": {
    "ratedPower": 5200,
    "nominalPV": 5000
  },
  "status": "Grid-Tie",
  "energyToday": 1.9
}
```

| Field | Meaning |
|-------|---------|
| `battery.current` | Amps; negative = charging, positive = discharging |
| `battery.soc` | State of charge 0–100 (Growatt: from API; ShineMonitor: API `BATTERY_SOC` when valid, else voltage estimate) |
| `grid.active` | Generator/grid source considered active (voltage + power thresholds) |
| `inverter.ratedPower` | AC nameplate (W) — used for load % |
| `inverter.nominalPV` | PV array nameplate (W) — used for solar % |
| `energyToday` | Today's PV energy (kWh), when available |

## Security

- **`API_TOKEN`** — Set only via `wrangler secret put`. Do not commit tokens, inverter passwords, or `.env` files. The repo `.gitignore` excludes `.env`.
- **Inverter credentials** — Stored encrypted in Workers KV when `CREDENTIALS_KEY` is set (`wrangler secret put CREDENTIALS_KEY`). Restrict Cloudflare account access; treat KV as sensitive.
- **Frontend token storage** — The access token is kept in `localStorage` (and optionally URL params for bookmarks). Anyone with the token can call your Worker API. Rotate the token if it is exposed.
- **HTTPS only** — Use HTTPS for both the Worker and frontend in production.
- **Dev mode** — If `API_TOKEN` is unset, the Worker accepts unauthenticated requests. Never deploy to production without the secret.
- **Rate limiting** — Data routes are capped at 60 requests/minute per bearer token (per isolate). Returns 429 with `Retry-After` when exceeded. Protects upstream inverter APIs from burst polling or scripted clients.

## Documentation

| Document | Description |
|----------|-------------|
| [worker/DEPLOY.md](./worker/DEPLOY.md) | Worker deployment runbook (KV, secrets, cron, CI) |
| [PLAN.md](./PLAN.md) | Project plan and roadmap |
| [discovery/ADAPTER_GUIDE.md](./discovery/ADAPTER_GUIDE.md) | **Adding a new inverter brand** — adapter interface, tests, registration |
| [discovery/README.md](./discovery/README.md) | Discovery folder index (ShineMonitor quick start) |
| [discovery/API.md](./discovery/API.md) | ShineMonitor API reference |
| [discovery/growatt/README.md](./discovery/growatt/README.md) | Growatt API discovery notes |
| [discovery/growatt/API.md](./discovery/growatt/API.md) | Growatt API reference |
| [RELEASE_NOTES.md](./RELEASE_NOTES.md) | Version history |

## Repository Layout

```
├── index.html, app.js, style.css   # Static frontend
├── worker/
│   ├── src/index.js                # Worker entry + REST routes + scheduled alerts
│   ├── src/history.js              # Shared adapter helpers (daily summary math, SOC merge)
│   ├── src/services/               # ShineMonitor & Growatt adapters
│   └── wrangler.toml               # Worker + KV binding (+ optional alert cron)
└── discovery/                      # Reverse-engineered vendor API docs
```

## License

Personal automation use. Respect ShineMonitor / Growatt terms of service; vendor APIs are undocumented and may change without notice.
