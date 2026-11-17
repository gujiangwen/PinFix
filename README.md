# SightLoop

Business-decoupled R&D self-healing platform: Chromium MV3 extension + local Agent Loop daemon + Admin.

**Milestone 1** ships the monorepo skeleton, SQLite-backed **Project Registry**, loopback-authenticated Fastify daemon, and a minimal Admin UI to list/create/edit projects.

## Stack

| Piece | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Daemon | Fastify 5 on `127.0.0.1:7420` |
| DB | SQLite via `better-sqlite3` |
| Shared types | Zod in `@sightloop/shared` |
| Admin | Vite + React 19 |

## Layout

```text
apps/
  daemon/     # Project Registry + /health
  admin/      # Minimal project CRUD UI
packages/
  shared/     # Zod DTOs / API error shape
  db/         # Schema migrations + repositories
  sniff/      # stub (M2)
  agent-runtime/  # stub (M3)
  markup-bridge/  # stub (M3)
data/         # runtime sqlite (gitignored)
```

## Prerequisites

- Node.js ≥ 22
- pnpm 10.x (`corepack enable` or install via npm)

## Setup

```bash
cp .env.example .env
# edit SIGHTLOOP_TOKEN / SIGHTLOOP_ALLOWED_ROOTS as needed

pnpm install
pnpm build
```

## Run daemon

```bash
# loads .env from repo root when started from root
export $(grep -v '^#' .env | xargs)   # or use direnv / your shell
pnpm dev:daemon
```

Health check (no token):

```bash
curl -s http://127.0.0.1:7420/health
```

Register a project (path must exist and fall under `SIGHTLOOP_ALLOWED_ROOTS`; `PINFIX_ALLOWED_ROOTS` is accepted as an alias):

```bash
mkdir -p /tmp/sightloop-demo
curl -s -X POST http://127.0.0.1:7420/v1/projects \
  -H 'Content-Type: application/json' \
  -H "X-SightLoop-Token: $SIGHTLOOP_TOKEN" \
  -d '{
    "name": "demo",
    "repo_path": "/tmp/sightloop-demo",
    "origin_pattern": "http://localhost:5173/*",
    "verify_cmd": "pnpm test",
    "file_whitelist": ["src/**"],
    "mode": "hmr"
  }'
```

Auth header aliases: `X-SightLoop-Token` or `X-PinFix-Token` (or `Authorization: Bearer …`).

## Run Admin

```bash
pnpm dev:admin
```

Open http://127.0.0.1:5173 — set `VITE_DAEMON_URL` / `VITE_DAEMON_TOKEN` in `.env` (Vite picks up `VITE_*` automatically if you start from the admin package with env loaded, or copy those two into `apps/admin/.env`).

Quick local Admin env:

```bash
cat > apps/admin/.env <<EOF
VITE_DAEMON_URL=http://127.0.0.1:7420
VITE_DAEMON_TOKEN=dev-token-change-me
EOF
pnpm --filter @sightloop/admin dev
```

## Project Registry fields

| Field | Purpose |
|---|---|
| `repo_path` | Absolute path; `realpath` must sit under allowed roots |
| `origin_pattern` | Which page origins may attach (extension, later) |
| `verify_cmd` | Optional post-edit verify shell command |
| `file_whitelist` | Relative globs the agent may edit |
| `mode` | `hmr` \| `pr` |

## Security (M1)

- Daemon binds loopback by default.
- Non-`/health` routes require the shared token **and** a loopback peer.
- `repo_path` registration is rejected with `path_escape_blocked` when outside allowed roots (audited in SQLite `audit_log`).

## Out of scope for M1

Extension / sniffing, Agent Loop, markup-mcp, knowledge distill, full observability Admin.
