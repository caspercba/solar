# Project State

_Last updated: 2026-07-28_

Board: [Gordofast — solar](http://100.103.17.20:3000/projects/4fef956d-9607-40d9-8625-b910b544acb5)

## Done

- Phases 1–4 complete (dashboard, adapters, vendor-only history, alerts, CI, PWA, HA bridge, i18n, themes, compare view, settings hub, grid label, low-SOC card warning, generator runtime, gridDetect thresholds)
- ADR 0002 Phases 1–2 — mutation audit log + per-user opaque API keys
- ADR 0003 — password users, magic-link invites, auth/admin UI, Worker Vitest + Playwright E2E (`invite.spec.js`, `admin.spec.js`, `legacy-token.spec.js`, setup login)
- Discovery spikes for Solis / Deye / SMA (`discovery/{solis,deye,sma}/`); Victron withdrawn (ADR 0001)
- **v1.4.0** tagged and deployed locally (Pages + Worker) — GitHub Actions deploy still unfunded; tag `v1.4.0` is on origin
- ADR 0003 marked Done in decision doc
- Chart view: daily production + daily consumption tiles; daily solar production tile polish
- **SOLAR-0160** — Cards landing "Today's production" tile: full-width amber sparkline with overlaid kWh total, current plant-local day, i18n + empty/loading states
- **SOLAR-0161** — Playwright coverage for the Cards "Today's production" tile (data + empty states); reuses tested `aggregateHourlyProduction` frontend helper
- Pages stage fix — include `frontend/i18n.js` (`scripts/stage-frontend.sh`)
- Prior board work through SOLAR-0154 archived `done`
- **Compare as landing (SOLAR-0164…0169)** — HOME summary tiles with independent per-tile loading; DETAIL Cards/Flow/Chart; i18n/a11y; polish; Playwright coverage for landing/tap-through/back (acceptance green). Full suite still red on two unrelated/implementation bugs (SOLAR-0170, SOLAR-0171).
- **SOLAR-0172** — Tester failure follow-up for SOLAR-0169
- **SOLAR-0174** — Growatt `fetchHistory()`/`fetchHistorySummary()` now default to the plant-local calendar date (new `localDate(tzOffsetSeconds)` helper, mirrors ShineMonitor) instead of the Worker's UTC date. `discover()` captures the vendor `timezone` field (hours) from `getPlantData` and stores it as `credentials.timezone` (seconds); existing systems without a stored timezone fall back to UTC (unchanged prior behavior) until re-added/re-discovered.
- **Daily production tile — Rio del medio (ShineMonitor) always current-day** — `shinemonitor.js` `fetchHistory()` no longer falls back to yesterday's data when the current plant-local day has zero rows yet (e.g. right after local midnight, before sunrise); it now returns an empty `today` result so the tile/chart correctly shows empty instead of silently displaying yesterday's full-day production. The equivalent fallback in `fetchData()` (realtime status snapshot) is intentional and unchanged.

## In Progress

- **SOLAR-0173** — `in_progress`, planner — "casita del rio bugs" triage (this pass); root-caused and filed as SOLAR-0174/0175 below

## Up Next

_Live board (`task.list`). Priority order:_

1. **SOLAR-0170** — `backlog`, high (developer) — Fix: removing a system does not refresh HOME summary tiles (`detailRemove` skips `renderComparisonGrid` / `pollCompareNow` when removed id ≠ active)
2. **SOLAR-0171** — `backlog`, high (developer) — Fix: duplicate `#admin-create-user-section` in `index.html` (+ duplicate `els` bindings in `app.js`); keep password+confirm form
3. **SOLAR-0175** — `backlog`, high (developer) — Investigate + fix: generator status not shown for Casita del Rio (Growatt off-grid SPF 3500 ES). Shared `isGridActive` / `grid.active` render path looks structurally correct across systems — likely a per-system `gridDetect` threshold misconfig or a live vendor-field quirk on this device; needs a live capture while the generator is running to confirm root cause.
4. **SOLAR-0155** — `backlog`, high (developer) — Release: confirm CI release-gate/deploy or manual `wrangler deploy` for v1.4.0; production `/api/health` reports 1.4.0

**Deferred (no board tasks — wait for human request):**

- Solis / Deye / SMA production adapters (discovery only)
- Cloudflare Access on admin surfaces (ADR 0002 Phase 3)
- Password-reset invite purpose (`purpose: onboard | reset`) — ADR 0003 later iteration
- WebSocket push — evaluated and deferred (`discovery/WEBSOCKET_REALTIME.md`)

## Blocked

_None on the live board._

## Decisions Made

- **No frontend build step** — plain HTML/CSS/JS with cache-busting `?v=N` params.
- **Cloudflare Worker as sole backend** — required for Growatt CORS; KV for configs/auth only; no historical data archive.
- **Normalize at adapter boundary** — one JSON shape for the frontend.
- **Vendor-only history** — charts/summaries fetch from inverter APIs on demand.
- **Multi-user — opaque keys (ADR 0002)** — shared `API_TOKEN` + KV keys (`read`/`admin`) + mutation audit; Cloudflare Access optional later.
- **Multi-user — password accounts + invites (ADR 0003)** — shipped end-to-end at v1.4.0; no outbound email; opaque keys and `?token=` retained for machines/migration.
- **Frontend and Worker stay independently deployable** — Pages vs Workers; CORS allowlist.
- **Cards today’s production tile** — full-width line graph with kWh overlay (not side-by-side); current day only; mock in `docs/mocks/`.
- **Compare as landing (shipped)** — dashboard home is multi-system compare tiles; detail is per-system Cards/Flow/Chart; mocks + spec in `docs/mocks/compare-as-landing.md`; SOLAR-0164…0169 done; follow-up fixes SOLAR-0170/0171.

## Blocked / Open Questions

1. Should frontend and worker share a Cloudflare project? _(Still independently deployable; revisit only if it becomes painful.)_

## Known Risks

- **Upstream API breakage** — ShineMonitor/Growatt can change without notice; discovery scripts first line of detection.
- **Session cache per isolate** — cold starts re-authenticate; Growatt cookies in KV help.
- **Vendor history gaps / rate limits** — empty states, in-memory cache, and `days` cap mitigate.
- **Production secrets** — `API_TOKEN` and `CREDENTIALS_KEY` required; fail-closed when `PRODUCTION` set.
- **Invite / password sharing** — mitigate with TTL, single-use conversion, revoke, hash-only storage.
- **Last-admin lockout** — user-admin routes refuse deleting/disabling the final `admin`.
- **CI unfunded** — GitHub Actions tests/deploys may not run; prefer local `wrangler` + manual tag when releasing.
- **E2E red on manage-remove + admin create-user** — SOLAR-0170 / SOLAR-0171; Compare-as-landing acceptance coverage itself passed under SOLAR-0169.
- **Growatt timezone handling** — no per-system timezone offset stored/used (unlike ShineMonitor's `localDate` helper); `fetchHistory` hardcodes `timezoneOffset: 0` and defaults history queries to UTC date, causing empty daily-production data around the UTC day boundary for non-UTC systems (SOLAR-0174).
