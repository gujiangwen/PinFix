# SightLoop architecture

**M1:** Daemon Project Registry + SQLite + minimal Admin.

**M2:** Chrome MV3 extension (Shadow DOM pick UI) + `@sightloop/sniff` (React → Vue3 → DOM) + `POST /v1/sessions` + WebSocket status subscribe + React fixture app.

## Extension worlds

| Script | World | Role |
|---|---|---|
| `background` | Extension SW | Daemon REST/WS, settings, session create |
| `content` | Isolated | Closed Shadow DOM toolbar, pick highlight, annotation bubble |
| `injected` | Main (`world: MAIN`) | Runs `@sightloop/sniff` against page Fiber/Vue expandos |

Bridge: `window.postMessage` with `source: sightloop-ext|sightloop-page` + nonce.

## Daemon (M2 additions)

- `POST /v1/sessions` — create idle session with sniff + optional annotation
- `GET /v1/sessions/:id` / `GET /v1/sessions?project_id=`
- `WS /v1/ws?token=` — `{ op: "subscribe", session_id }` → `session.status` events
