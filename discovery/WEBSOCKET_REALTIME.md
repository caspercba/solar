# ShineMonitor “WebSocket” Realtime — Feasibility Spike

_Spike date: 2026-07-07 · Task: evaluate `ws.shinemonitor.com` for push realtime_

## Recommendation: **Defer**

Do **not** implement WebSocket or SSE push for ShineMonitor in Solar Dashboard at this time.

The hostname `ws.shinemonitor.com` is a **legacy HTTP API gateway**, not a WebSocket server. ShineMonitor’s own web UI uses **request/response polling** over signed HTTP GET. Our existing Worker + configurable HTTP poll (30 / 60 / 120 s) is the correct transport. Revisit only if Eybond documents a genuine push channel or the portal adds observable WebSocket subscriptions.

---

## 1. What we investigated

| Question | Finding |
|----------|---------|
| Is `ws.shinemonitor.com` a WebSocket endpoint? | **No.** `/ws` is an HTTP path prefix; requests use jQuery `$.ajax` GET/JSONP. |
| Does the vendor portal push updates? | **No push streams observed.** Plant list loads `plantCurrentData` on demand via `http_normal_oper`. |
| Can the Worker proxy WS → SSE for the browser? | **Technically yes** (Workers support `WebSocketPair` and streaming `Response`), but **there is no upstream WS to proxy**. |
| Is push worth building on hypothetical WS? | **No** for this product today — see latency section. |

---

## 2. Evidence: `ws` is HTTP, not WebSocket

### 2.1 Portal JavaScript (`libhttp.js`)

The function named `http_normal_oper` is the entry point for “realtime” plant metrics on the legacy host:

```javascript
function http_normal_oper(action, operOnSuccess, operOnError) {
  http_oper("ws", action, operOnSuccess, operOnError);
}

function http_oper(prefix, action, operOnSuccess, operOnError) {
  var url = HTTP_INTERFACE_ADDRESS + prefix + "?sign=" + sign + "&salt=" +
    salt + "&token=" + currUsr.token + action.replace(/#/g, "%23");
  http_async_request(url, operOnSuccess, operOnError);  // jQuery $.ajax GET + JSONP
}
```

`HTTP_INTERFACE_ADDRESS` resolves to `https://ws.shinemonitor.com/` (domain check / node list at login). The `"ws"` string is a **URL path segment** (`…/ws?sign=…&action=…`), not the WebSocket protocol.

Example actions on this host:

| Action | Purpose |
|--------|---------|
| `plantCurrentData` | Plant-level keys (`ENERGY_TODAY`, `CURRENT_POWER`, `BATTERY_SOC`, …) |
| `plantDeviceStatus` | Online/offline per device |

### 2.2 Modern data plane (what we use today)

Dashboard realtime already goes through **`https://web.shinemonitor.com/public/`** — same signing scheme, richer device-level fields (`queryPlantCurrentData`, `queryDeviceRealLastData`). This is what `worker/src/services/shinemonitor.js` implements.

The `ws` host is an **older parallel HTTP API** used for plant-list widgets and admin flows, not a push transport.

### 2.3 WebSocket handshake probe

An RFC 6455 upgrade against `https://ws.shinemonitor.com/ws` returns **HTTP 404**, not `101 Switching Protocols`. See `discovery/ws_probe.py` (`--handshake-only`).

### 2.4 Third-party reverse engineering

The [ha-shinemonitor](https://github.com/tarun7singh/ha-shinemonitor) API notes state: _“WebSocket / push streams. None observed — the UI is poll-only.”_

---

## 3. Hypothetical Worker WS → SSE bridge

Even if a real upstream WebSocket existed, a Solar Dashboard design would look like:

```
Browser                    Cloudflare Worker                 ShineMonitor
   │  GET /api/.../stream       │                                │
   │  Accept: text/event-stream │  WebSocket (signed, credentialed) │
   │ ─────────────────────────► │ ───────────────────────────────► │
   │ ◄──── SSE data: {...} ──── │ ◄──── vendor push frames ─────── │
```

**Worker capabilities (Cloudflare):**

- Accept browser WebSocket via `WebSocketPair` or emit SSE with a streaming `Response`.
- Hold an outbound `fetch()` with `Upgrade: websocket` to the vendor (when supported).

**Blockers for this project:**

| Blocker | Impact |
|---------|--------|
| No upstream WebSocket API | Nothing to connect to |
| Growatt has no WS equivalent | Push would be ShineMonitor-only; architecture stays split |
| Isolate lifetime | Worker isolates are short-lived; long-lived WS needs **Durable Objects** (+ cost/complexity) |
| Multi-tab / multi-user fan-out | One upstream session per system vs many browser clients — needs pub/sub layer |
| Credentials in Worker | Same as today (KV + encrypt); no browser exposure benefit beyond poll |
| Zero-build frontend | SSE/WS client code is fine in plain JS, but adds reconnect/backoff state |

**Verdict:** Infrastructure is feasible on Cloudflare, but **not justified** without a real vendor push source.

---

## 4. Latency: push vs 60 s polling

| Metric | 60 s HTTP poll (default) | 30 s poll (supported) | Hypothetical push |
|--------|--------------------------|------------------------|-------------------|
| Average data staleness | ~30 s | ~15 s | ~1–5 s (vendor-dependent) |
| Max staleness | 60 s | 30 s | ~5 s + reconnect gaps |
| Worker load per client | 1 req/min/system | 2 req/min/system | 1 persistent conn + keepalive |
| Vendor load | Same order as poll | 2× poll | Unknown; may rate-limit |
| Battery SOC UX | Adequate (slow-changing) | Adequate | Marginal gain |
| Solar power (cloud edges) | Coarser | Better | Best |

**Product context:** Solar Dashboard is a **glanceable** off-grid monitor, not SCADA. Users already have pull-to-refresh, configurable poll (30 s), and on-demand intraday charts. Sub-minute push adds operational complexity for modest UX gain on SOC and status fields.

**When push would matter:** Generator start/stop alerts — already planned via **Worker cron** (`*/5 * * * *`) evaluating thresholds, which is a better fit than holding thousands of browser WebSockets open.

---

## 5. Fallback strategy (current — keep)

```
┌─────────────┐     GET /api/systems/:id/data      ┌──────────────┐
│  app.js     │ ─────── every 30–120 s ──────────► │ Worker proxy │
│  (browser)  │ ◄──── normalized JSON ──────────── │ + adapter    │
└─────────────┘                                    └──────┬───────┘
       │                                                   │
       │ on failure: toast + retry + PTR                     │ signed HTTP GET
       ▼                                                   ▼
  localStorage poll interval                      web.shinemonitor.com/public/
```

No change required. If a future vendor push API appears:

1. Add optional `GET /api/systems/:id/stream` (SSE) behind feature flag.
2. Fall back to poll when stream errors or `Accept` header missing.
3. Keep Growatt on poll unless they add push.

---

## 6. Optional faster paths (without WebSocket)

| Option | Effort | Benefit |
|--------|--------|---------|
| Default poll **30 s** for active dashboard | Config only / UI default | Halves staleness |
| **Parallel** `/api/systems/all/data` | Implemented server-side; HOME now polls per-system instead (independent tile settling, compare-as-landing SOLAR-0165) | Multi-system refresh in one round-trip |
| **In-memory vendor cache** in Worker (5–10 s TTL) | Small | Dedup when multiple tabs hit same system |
| **Cron alerts** for SOC/generator | In progress | Timely notifications without browser open |

---

## 7. Prototype

`discovery/ws_probe.py` — stdlib-only script that:

1. Attempts a WebSocket upgrade (expects failure).
2. Optionally calls `plantCurrentData` on the legacy `ws` HTTP host when `SHINE_USER` / `SHINE_PASSWORD` are set.

```bash
# Handshake probe only (no credentials)
python3 discovery/ws_probe.py --handshake-only

# Compare legacy ws host vs web/public host (needs credentials)
export SHINE_USER='...' SHINE_PASSWORD='...'
python3 discovery/ws_probe.py
```

---

## 8. Documentation corrections

- [API.md](./API.md) § “Related hosts” — `ws.shinemonitor.com` should be described as **legacy HTTP**, not WebSocket.
- [PLAN.md](../PLAN.md) § 10.3 item 13 — treat as **deferred** pending vendor push API.

---

## 9. Decision log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-07 | **Defer** WS/SSE push | No upstream WebSocket; vendor UI is poll-only; 30–60 s HTTP poll meets UX goals |

**Revisit triggers:**

- Eybond publishes WebSocket/subscribe documentation.
- Portal JS starts using `new WebSocket(` or `wss://` against shinemonitor hosts.
- User requirement for sub-10 s realtime on power (not SOC) with measured vendor update rate.
