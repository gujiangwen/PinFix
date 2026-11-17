# SightLoop

Business-decoupled R&D self-healing platform: Chromium MV3 extension + local Agent Loop daemon + Admin.

**Milestone 4** adds full Admin observability (session timelines, diff, audit, metrics), Knowledge Hub (browse/edit/pin/archive + AGENTS.md sync), dual-loop retrieve with **sqlite-vec** similarity (Markdown cards remain source of truth), and HMR/PR mode controls.

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
  daemon/          # Registry + sessions + Agent Loop + Admin APIs + WS
  admin/           # Observability UI + Knowledge Hub
  extension/       # MV3 pick / annotate / review
  fixture-react/   # Sample page for pick demos
packages/
  shared/          # Zod DTOs / API error shape / session + review + admin
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
- Optional: `gh` authenticated for PR-mode Accept

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

## Run Admin (M4)

```bash
pnpm dev:admin
```

Open **http://127.0.0.1:5173** — set `VITE_DAEMON_URL` / `VITE_DAEMON_TOKEN` (see `apps/admin/.env.example`).

Tabs:

| Tab | Purpose |
|---|---|
| Projects | Registry + **HMR / PR mode** toggle |
| Sessions | List, step timeline (incl. knowledge recall hits), tool/reasoning summaries, timing/tokens when recorded, diff viewer |
| Knowledge | Browse / edit / pin / archive; filter by project / stack / tags; export MD; one-click **AGENTS.md** sync (allowed roots + whitelist) |
| Audit | Security / sync / path-escape events |
| Metrics | Session counts, failure rate, avg steps, knowledge totals |

### HMR vs PR mode

- **HMR** — Accept keeps the local temp commit for hot-reload preview; no remote push.
- **PR** — Accept also runs `gh pr create` (needs local `gh` auth). Outcome is audited; distill still succeeds if `gh` fails.

## Knowledge dual-loop + sqlite-vec

1. **Loop A (session):** Distill-on-Accept writes **Markdown** knowledge cards (source of truth; tags/stack from sniff).
2. **Loop B (cross-session):** On write, cards are embedded (`local-hash-v1`) into a **sqlite-vec** `vec0` index. Retrieve-before-act runs **similarity search first**, blends with text/pin scoring, then loads markup annotations. Admin timeline shows recall hits (`engine: sqlite-vec`) on the `list_knowledge` step.
3. No separate vector DB — same SQLite file as projects/sessions (`SIGHTLOOP_DB_PATH`).

## Smoke tests

Daemon must be running:

```bash
./scripts/smoke-m4.sh   # Admin APIs + recall order + AGENTS.md sync
./scripts/smoke-m3.sh   # Loop + Accept/Refine/Revert
./scripts/smoke-m2.sh
./scripts/smoke-m1.sh
```

## Agent Loop + review (curl)

```bash
# create session → start → diff → accept|refine|revert
# see scripts/smoke-m3.sh for a full scripted path
```

## Run fixture (pick demo page)

```bash
pnpm dev:fixture
```

Open http://localhost:5175.

## Load the Chrome extension

```bash
pnpm --filter @sightloop/extension build
# output: apps/extension/dist
```

Then in Chrome: `chrome://extensions` → Developer mode → Load unpacked → `apps/extension/dist`.

## Project Registry fields

| Field | Purpose |
|---|---|
| `repo_path` | Absolute path; `realpath` must sit under allowed roots |
| `origin_pattern` | Which page origins may attach (extension guidance) |
| `verify_cmd` | Optional post-edit verify shell command |
| `file_whitelist` | Relative globs the agent may edit; include `AGENTS.md` for Knowledge sync |
| `mode` | `hmr` \| `pr` (PR mode Accept tries `gh pr create`) |
| `markup_workspace` | Optional override; default under `MARKUP_WORKSPACE/<projectId>` |

## Admin / knowledge APIs (M4)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/v1/admin/metrics` | Session / failure / knowledge totals |
| `GET` | `/v1/admin/audit` | Security audit log |
| `GET` | `/v1/knowledge` | Filters: `project_id`, `stack`, `tag`, `kind`, `pinned`, `q`, `include_archived` |
| `POST` | `/v1/knowledge` | Create card |
| `PATCH` | `/v1/knowledge/:id` | Edit / pin / archive |
| `GET` | `/v1/knowledge/:id/export` | Markdown export |
| `POST` | `/v1/projects/:id/knowledge/sync-agents` | Safe AGENTS.md sync (`dry_run` supported) |

## Security

- Daemon binds loopback by default.
- Non-`/health` routes require the shared token **and** a loopback peer.
- WS auth: `?token=` (or header on upgrade).
- `repo_path` registration / AGENTS.md sync rejected when outside allowed roots or whitelist.
- Agent edits are locked per `repo_path`; `max_steps` capped at 5.
- LLM / MarkUp license keys live only in Daemon env — never in the extension.

## Out of scope

New browser platforms beyond Chrome; vector DB (Markdown knowledge only).
