# Project State

_Last updated: 2026-07-22_

## Done

- Phases 1–4 complete (dashboard, adapters, vendor-only history, alerts, CI, PWA, HA bridge, i18n, themes, compare view, settings hub, grid label, low-SOC card warning, generator runtime, gridDetect thresholds)
- ADR 0002 Phases 1–2 — mutation audit log + per-user opaque API keys
- ADR 0003 — password users, magic-link invites, auth/admin UI, Worker Vitest + Playwright E2E (`invite.spec.js`, `admin.spec.js`, `legacy-token.spec.js`, setup login)
- Discovery spikes for Solis / Deye / SMA (`discovery/{solis,deye,sma}/`); Victron withdrawn (ADR 0001)
- **v1.4.0** version bump on `main` (`package.json`, `GET /api/health`, `RELEASE_NOTES.md`); ARCHITECTURE.md synced to shipped auth UX
- Prior board work through SOLAR-0154 archived `done` (Worker/FE/tests/docs/release notes)

## In Progress

- **SOLAR-0153** — planner: read md files and create new tasks (this pass)

## Up Next

_Live board (`task.list`). Priority order:_

1. **SOLAR-0155** — `backlog`, high — cut and push annotated git tag `v1.4.0` so CI can deploy the Worker (notes/version already at 1.4.0; only tags `v1.3.0` / `v1.3.1` exist locally).
2. **SOLAR-0156** — `backlog`, low — mark ADR 0003 relationship/recommendation text Done (still says Planned).

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

## Blocked / Open Questions

1. Should frontend and worker share a Cloudflare project? _(Still independently deployable; revisit only if it becomes painful.)_

## Known Risks

- **Upstream API breakage** — ShineMonitor/Growatt can change without notice; discovery scripts first line of detection.
- **Session cache per isolate** — cold starts re-authenticate; Growatt cookies in KV help.
- **Vendor history gaps / rate limits** — empty states, in-memory cache, and `days` cap mitigate.
- **Production secrets** — `API_TOKEN` and `CREDENTIALS_KEY` required; fail-closed when `PRODUCTION` set.
- **Invite / password sharing** — mitigate with TTL, single-use conversion, revoke, hash-only storage.
- **Last-admin lockout** — user-admin routes refuse deleting/disabling the final `admin`.
- **Untagged v1.4.0** — code/docs report 1.4.0 but no git tag yet; production Worker deploy will not run until SOLAR-0155 lands.
