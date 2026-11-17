# SightLoop

Business-decoupled R&D self-healing platform: Chromium MV3 extension + local Agent Loop daemon + Admin.

**Milestone 2** adds the Chrome extension (Shadow DOM pick UI), `@sightloop/sniff` (React → Vue 3 → DOM), Daemon sessions + WebSocket status, and a small React fixture app for manual demos.

## Stack

| Piece | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Daemon | Fastify 5 on `127.0.0.1:7420` (+ `@fastify/websocket`) |
| DB | SQLite via `better-sqlite3` |
| Shared types | Zod in `@sightloop/shared` |
| Sniff | `@sightloop/sniff` (Vitest + happy-dom) |
| Extension | Vite + `@crxjs/vite-plugin` (Chrome MV3 only) |
| Admin | Vite + React 19 |
| Fixture | Vite + React 19 (`apps/fixture-react`) |

## Layout

```text
apps/
  daemon/          # Project Registry + sessions + WS
  admin/           # Minimal project CRUD UI
  extension/       # MV3 pick / annotate / submit
  fixture-react/   # Sample page for pick demos
packages/
  shared/          # Zod DTOs / API error shape / session + WS
  db/              # Schema migrations + repositories
  sniff/           # React Fiber / Vue3 / DOM waterfall
  agent-runtime/   # stub (M3)
  markup-bridge/   # stub (M3)
data/              # runtime sqlite (gitignored)
```

## Prerequisites

- Node.js ≥ 22
- pnpm 10.x (`corepack enable` or install via npm)
- Google Chrome (extension is Chrome-only)

## Setup

```bash
cp .env.example .env
# edit SIGHTLOOP_TOKEN / SIGHTLOOP_ALLOWED_ROOTS as needed

pnpm install
pnpm build
pnpm test   # @sightloop/sniff unit tests
```

## Run daemon

```bash
export $(grep -v '^#' .env | xargs)   # or use direnv / your shell
pnpm dev:daemon
```

Health check (no token):

```bash
curl -s http://127.0.0.1:7420/health
```

Register a project pointed at the fixture origin:

```bash
mkdir -p /tmp/sightloop-demo
curl -s -X POST http://127.0.0.1:7420/v1/projects \
  -H 'Content-Type: application/json' \
  -H "X-SightLoop-Token: $SIGHTLOOP_TOKEN" \
  -d '{
    "name": "fixture-react",
    "repo_path": "/tmp/sightloop-demo",
    "origin_pattern": "http://localhost:5175/*",
    "mode": "hmr"
  }'
```

### Sessions + WebSocket (M2)

```bash
# create session
curl -s -X POST http://127.0.0.1:7420/v1/sessions \
  -H 'Content-Type: application/json' \
  -H "X-SightLoop-Token: $SIGHTLOOP_TOKEN" \
  -d '{
    "project_id": "<id>",
    "page_url": "http://localhost:5175/",
    "sniff": { "framework": "react", "componentStack": [{"name":"ProductCard"}] },
    "annotation": { "note": "button color" }
  }'

# subscribe (token via query — WS cannot set custom headers)
# { "op": "subscribe", "session_id": "<id>" }
# → { "type": "session.status", "session_id", "status": "idle", "step_count": 0 }
```

Automated smoke (daemon must be running):

```bash
./scripts/smoke-m2.sh
```

## Run fixture (pick demo page)

```bash
pnpm dev:fixture
```

Open http://localhost:5175 — React components with Fiber metadata for sniffing.

## Load the Chrome extension

```bash
pnpm --filter @sightloop/extension build
# output: apps/extension/dist
```

Or for HMR during development:

```bash
pnpm dev:extension
```

Then in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `apps/extension/dist`
4. Open the SightLoop popup → set Daemon URL `http://127.0.0.1:7420`, token from `.env`, **Refresh projects**, select the fixture project, **Save**
5. Open http://localhost:5175
6. Press **Alt+Shift+A** (or popup → Toggle pick) → hover highlight → click a card
7. Add an annotation note → **Submit** (single) or **Add to batch** then **Submit batch**
8. Toolbar shows session id / WS `session.status` updates

Shadow DOM keeps the floating toolbar isolated from host CSS. Sniffing runs in the **Main World** inject script; the content script only bridges messages.

## Run Admin

```bash
pnpm dev:admin
```

Open http://127.0.0.1:5173 — set `VITE_DAEMON_URL` / `VITE_DAEMON_TOKEN` (see `apps/admin/.env.example`).

## Project Registry fields

| Field | Purpose |
|---|---|
| `repo_path` | Absolute path; `realpath` must sit under allowed roots |
| `origin_pattern` | Which page origins may attach (extension guidance) |
| `verify_cmd` | Optional post-edit verify shell command |
| `file_whitelist` | Relative globs the agent may edit |
| `mode` | `hmr` \| `pr` |

## Security

- Daemon binds loopback by default.
- Non-`/health` routes require the shared token **and** a loopback peer.
- WS auth: `?token=` (or header on upgrade).
- `repo_path` registration is rejected with `path_escape_blocked` when outside allowed roots.
- Sniff redacts sensitive prop keys (`password`, `token`, `authorization`, …); never serializes input values by default.

## Out of scope for M2

Agent Loop / `pi` / markup-mcp / Accept-Refine-Revert / knowledge distill / full Admin observability (M3/M4).
