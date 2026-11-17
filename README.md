# SightLoop

Business-decoupled R&D self-healing platform: Chromium MV3 extension + local Agent Loop daemon + Admin.

**Milestone 9** adds an optional **LangGraph dual-loop** (Planner → Implementer → Reviewer) behind `SIGHTLOOP_DUAL_LOOP=0` by default. M9a = mock Planner/Reviewer + PlanIR whitelist; **M9b** = real Planner/Reviewer LLMs with **separate** `SIGHTLOOP_PLANNER_*` / `SIGHTLOOP_IMPLEMENTER_*` / optional `SIGHTLOOP_REVIEWER_*` configs (mock fallback when planner key missing).

**Milestone 10:** DX GitHub credential health + heal hints (M10a); editable PlanIR in the extension 验收 drawer (M10b); Accept archives Scenario IR + baselines to `<repo>/acceptance/` (M10c).

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

## 一键本地 DX（M5）

Cold start without hand-copying `.env` into the extension:

```bash
pnpm install && pnpm build
cp -n .env.example .env   # if needed
pnpm dev:daemon           # terminal 1 — http://127.0.0.1:7420
pnpm --filter @sightloop/extension build
# Chrome → chrome://extensions → Developer mode → Load unpacked → apps/extension/dist
```

1. Open the SightLoop **Popup** (本地 DX wizard).
2. It probes `GET /health` on port candidates (`7420`, …) then `GET /v1/dx/status` (loopback, no token).
3. Click **一键准备 Demo** → `POST /v1/dx/ensure-fixture-project` (sandbox under allowed roots + `origin_pattern=http://localhost:5175/*`).
4. Optional: set `SIGHTLOOP_DX_BOOTSTRAP=1` and restart daemon so **Bootstrap token** can fill the loopback token (never enable on shared hosts).
5. Run `pnpm dev:fixture` → open http://localhost:5175 → **Alt+Shift+A** to pick.

Status lights: **Daemon / Token / Project**. Runner badge: **mock** (no LLM key) vs **pi** (key present). Toolbar strip mirrors `Daemon ● · Runner: mock|pi`.

DX APIs:

| Method | Path | Notes |
|---|---|---|
| `GET` | `/v1/dx/status` | Loopback public; runner mode + fixture id (no secrets) |
| `POST` | `/v1/dx/bootstrap` | Only if `SIGHTLOOP_DX_BOOTSTRAP=1` |
| `POST` | `/v1/dx/ensure-fixture-project` | Idempotent demo project (token required) |

```bash
./scripts/smoke-m5.sh
./scripts/smoke-m6.sh   # acceptance read-model + distilled_knowledge
./scripts/smoke-m7.sh   # locate + files + source-correct round-trip
./scripts/smoke-m8a.sh  # Playwright fixture gate + Accept 409/200
```

### Playwright acceptance gate (M8a)

Install Chromium once (Daemon runs Playwright locally — not in the extension):

```bash
pnpm --filter @sightloop/acceptance-gate exec playwright install chromium
pnpm dev:fixture   # http://127.0.0.1:5175 — or any loopback fixture origin
```

On `awaiting_review`, Daemon auto-runs the gate (fixture URL only). Overlay shows **浏览器验收**; Accept requires a **passed** run (`require_pass_to_accept`). Structured `annotation.expects` (selector + type) are required to compile the scenario.

### Source location (M7)

Pick shows a **confidence badge** (`high|medium|low`) and file candidate. Low/medium offers **纠正文件** (searches `GET /v1/projects/:id/files`). Correcting calls `POST /v1/sessions/:id/source-correct`, which updates sniff `location`, upserts `source_location_hints`, and writes a `selector_map` knowledge card. Re-locate with the same selector returns high confidence from memory.

### Acceptance overlay (M6)

When a session reaches `awaiting_review`, the Shadow toolbar opens **验收** with:

1. **Diff 摘要** — files +/− counts; expand for unified patch  
2. **Verify** — pass/fail + log tail (if `verify_cmd` ran)  
3. **本轮召回** — sqlite-vec / pin knowledge hits from Retrieve  
4. **时间线** — retrieve → act → verify → refine notes → status  
5. After **Accept** — **已写入知识** card (`distilled_knowledge` / WS `session.knowledge_distilled`)

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
./scripts/smoke-m9a.sh  # dual-loop mock (DUAL_LOOP=1 MOCK=1)
./scripts/smoke-m9b.sh  # dual-loop llm mode (DUAL_LOOP=1 MOCK=0; falls back without PLANNER_API_KEY)
./scripts/smoke-m10a.sh # DX github health + heal_hint (no secrets)
./scripts/smoke-m10b.sh # PATCH plan under whitelist (needs DUAL_LOOP=1)
./scripts/smoke-m10c.sh # Accept → acceptance/ archive
./scripts/smoke-m8a.sh  # Playwright fixture gate (fail→409, pass→Accept)
./scripts/smoke-m7.sh   # locate + source-correct + hints/knowledge
./scripts/smoke-m6.sh   # acceptance overlay read-model + distill card
./scripts/smoke-m5.sh   # DX status + ensure-fixture + bootstrap gate
./scripts/smoke-m4.sh   # Admin APIs + recall order + AGENTS.md sync
./scripts/smoke-m3.sh   # Loop + Accept/Refine/Revert
./scripts/smoke-m2.sh
./scripts/smoke-m1.sh
```

Requires: `pnpm --filter @sightloop/acceptance-gate exec playwright install chromium` before smoke-m8a.

### Dual-loop (M9a mock / M9b LLM)

Default **off** (`SIGHTLOOP_DUAL_LOOP=0`) — legacy single-loop unchanged.

```bash
# M9a mock
SIGHTLOOP_DUAL_LOOP=1
SIGHTLOOP_DUAL_LOOP_MOCK=1
SIGHTLOOP_DUAL_LOOP_FORCE_REFINE=1   # smoke: one inner refine

# M9b real Planner/Reviewer (Implementer stays pi|mock via its own keys)
SIGHTLOOP_DUAL_LOOP=1
SIGHTLOOP_DUAL_LOOP_MOCK=0
SIGHTLOOP_PLANNER_API_KEY=…         # required for llm backend; else mock fallback
SIGHTLOOP_PLANNER_MODEL=gpt-4o-mini
# SIGHTLOOP_REVIEWER_API_KEY=…      # optional; defaults to planner
# SIGHTLOOP_IMPLEMENTER_API_KEY=…   # separate from planner (pi path)
```

`GET /v1/dx/status` exposes `dual_loop.{enabled,mode,planner_backend,reviewer_backend,fallback_reason,planner_model,implementer_model,reviewer_model}`.

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
