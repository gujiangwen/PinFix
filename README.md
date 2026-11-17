# SightLoop

Business-decoupled R&D self-healing platform: Chromium MV3 extension + local Agent Loop daemon + Admin.

**Milestone 3** adds markup workspace dual-adapters, Agent Loop (retrieve → act → verify → temp commit), Accept / Refine / Revert, Distill-on-Accept, and a mock runner so demos work without LLM keys.

## Stack

| Piece | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Daemon | Fastify 5 on `127.0.0.1:7420` (+ `@fastify/websocket`) |
| DB | SQLite via `better-sqlite3` |
| Shared types | Zod in `@sightloop/shared` |
| Sniff | `@sightloop/sniff` (Vitest + happy-dom) |
| Markup | `@sightloop/markup-bridge` (self + optional `markup-mcp`) |
| Agent | `@sightloop/agent-runtime` (`pi` or mock) |
| Extension | Vite + `@crxjs/vite-plugin` (Chrome MV3 only) |
| Admin | Vite + React 19 |
| Fixture | Vite + React 19 (`apps/fixture-react`) |

## Layout

```text
apps/
  daemon/          # Registry + sessions + Agent Loop + WS
  admin/           # Minimal project CRUD UI
  extension/       # MV3 pick / annotate / review
  fixture-react/   # Sample page for pick demos
packages/
  shared/          # Zod DTOs / API error shape / session + review + WS
  db/              # Schema migrations + repositories
  sniff/           # React Fiber / Vue3 / DOM waterfall
  markup-bridge/   # Workspace writer/reader + dual adapters
  agent-runtime/   # Loop, mock/pi runners, git, distill
data/              # runtime sqlite / markup / locks (gitignored)
```

## Prerequisites

- Node.js ≥ 22
- pnpm 10.x (`corepack enable` or install via npm)
- Google Chrome (extension is Chrome-only)
- `git` on PATH (temp commits / revert)

## Setup

```bash
cp .env.example .env
# edit SIGHTLOOP_TOKEN / SIGHTLOOP_ALLOWED_ROOTS as needed
# optional: set OPENAI_API_KEY / ANTHROPIC_API_KEY for real pi runs

pnpm install
pnpm build
pnpm test
```

Without any LLM API key, the daemon uses the **mock AgentRunner** (whitelist-safe edit) so Accept / Refine / Revert still demo end-to-end.

## Run daemon

```bash
export $(grep -v '^#' .env | xargs)   # or use direnv / your shell
pnpm dev:daemon
```

Health check (no token):

```bash
curl -s http://127.0.0.1:7420/health
```

Register a project pointed at a git repo under allowed roots:

```bash
mkdir -p /tmp/sightloop-m3-demo && git -C /tmp/sightloop-m3-demo init
curl -s -X POST http://127.0.0.1:7420/v1/projects \
  -H 'Content-Type: application/json' \
  -H "X-SightLoop-Token: $SIGHTLOOP_TOKEN" \
  -d '{
    "name": "fixture-react",
    "repo_path": "/tmp/sightloop-m3-demo",
    "origin_pattern": "http://localhost:5175/*",
    "file_whitelist": ["src/**"],
    "mode": "hmr"
  }'
```

### Agent Loop + review (M3)

```bash
# 1) create session — also writes markup workspace files
curl -s -X POST http://127.0.0.1:7420/v1/sessions \
  -H 'Content-Type: application/json' \
  -H "X-SightLoop-Token: $SIGHTLOOP_TOKEN" \
  -d '{
    "project_id": "<id>",
    "page_url": "http://localhost:5175/",
    "sniff": { "framework": "react", "componentStack": [{"name":"ProductCard"}] },
    "annotation": { "note": "button color", "selector": "[data-testid=buy]" }
  }'

# 2) start loop → awaiting_review
curl -s -X POST http://127.0.0.1:7420/v1/sessions/<id>/start \
  -H "X-SightLoop-Token: $SIGHTLOOP_TOKEN" -H 'Content-Type: application/json' -d '{}'

# 3) inspect diff
curl -s http://127.0.0.1:7420/v1/sessions/<id>/diff \
  -H "X-SightLoop-Token: $SIGHTLOOP_TOKEN"

# 4) accept | refine | revert
curl -s -X POST http://127.0.0.1:7420/v1/sessions/<id>/review \
  -H "X-SightLoop-Token: $SIGHTLOOP_TOKEN" -H 'Content-Type: application/json' \
  -d '{"decision":"accept"}'
```

Automated smoke (daemon must be running; uses mock runner when no LLM key):

```bash
./scripts/smoke-m3.sh
# optional: SIGHTLOOP_SMOKE_DECISION=revert ./scripts/smoke-m3.sh
# optional: SIGHTLOOP_SMOKE_DECISION=refine ./scripts/smoke-m3.sh
```

M2 smoke remains available: `./scripts/smoke-m2.sh`.

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
6. Press **Alt+Shift+A** → pick → annotate → **Submit** (creates session, writes markup, starts loop)
7. When status is `awaiting_review`, use **Accept / Refine / Revert** in the toolbar

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
| `mode` | `hmr` \| `pr` (PR mode Accept tries `gh pr create`) |
| `markup_workspace` | Optional override; default under `MARKUP_WORKSPACE/<projectId>` |

## Security

- Daemon binds loopback by default.
- Non-`/health` routes require the shared token **and** a loopback peer.
- WS auth: `?token=` (or header on upgrade).
- `repo_path` registration is rejected with `path_escape_blocked` when outside allowed roots.
- Agent edits are locked per `repo_path`; `max_steps` capped at 5.
- LLM / MarkUp license keys live only in Daemon env (see `.env.example`) — never in the extension.
- Sniff redacts sensitive prop keys; never serializes input values by default.

## Out of scope for M3

Full Admin observability UI / knowledge hub polish (Milestone 4).
