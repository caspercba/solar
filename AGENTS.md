# AGENTS.md

Instructions for coding agents working in this repo. See `README.md` for full docs, `PLAN.md`/`STATE.md` for project context.

## Layout

- `index.html`, `app.js`, `style.css` — static frontend, no build step.
- `worker/` — Cloudflare Worker proxy (`npm test` = Vitest + Miniflare).
- `frontend/` — extracted pure helpers from `app.js` (`npm test` = Vitest + happy-dom).
- `e2e/` — Playwright specs against a mock Worker (`npm test` = Playwright).
- `discovery/` — vendor API reference docs and Python clients (ShineMonitor, Growatt).

## Setup

Each of `worker/`, `frontend/`, `e2e/` has its own `package.json`; install with `npm ci` in the directory you're working on.

### E2E / Playwright

There is no baked image with Chromium pre-installed — browsers are installed at runtime. `cd e2e && npm ci && npm test` is enough: the `pretest` hook (`e2e/scripts/ensure-browser.js`) runs `npx playwright install --with-deps chromium`, falling back to a browser-only install (+ `e2e/scripts/fetch-deps.js` for shared libraries) when `--with-deps` can't reach an apt mirror (no root, or restricted network — expected in sandboxed environments). Don't assume Chromium already exists; don't skip this step.

## Tests

```bash
cd worker && npm ci && npm test    # adapters, routes, alerts
cd frontend && npm ci && npm test  # pure helper functions
cd e2e && npm ci && npm test       # Playwright, mock Worker + static frontend
```

CI (`.github/workflows/ci.yml`) runs all three on every push and PR; only a semver tag (`vMAJOR.MINOR.PATCH`) triggers a production deploy.

## Conventions

- No frontend build step — plain HTML/CSS/JS, cache-busted with `?v=N` query params on static assets.
- Adapters normalize vendor data at the boundary (`worker/src/services/*.js`) — the frontend only understands one JSON shape (§3 in `PLAN.md`).
- History/summary data is fetched live from vendor APIs on every request; the Worker does not archive readings in KV.
