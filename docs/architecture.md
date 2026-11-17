# SightLoop architecture

**M1:** Daemon Project Registry + SQLite + minimal Admin.

**M2:** Chrome MV3 extension (Shadow DOM pick UI) + `@sightloop/sniff` (React → Vue3 → DOM) + `POST /v1/sessions` + WebSocket status subscribe + React fixture app.

**M3:** Markup dual-adapter + Agent Loop (retrieve → act → verify → temp commit) + Accept / Refine / Revert + Distill-on-Accept.

**M4:** Admin observability + Knowledge Hub + dual-loop retrieve (knowledge before markup) + HMR/PR mode polish + AGENTS.md sync.

## Extension worlds

| Script | World | Role |
|---|---|---|
| `background` | Extension SW | Daemon REST/WS, settings, session create/start/review |
| `content` | Isolated | Closed Shadow DOM toolbar, pick highlight, annotation bubble, review buttons |
| `injected` | Main (`world: MAIN`) | Runs `@sightloop/sniff` against page Fiber/Vue expandos |

Bridge: `window.postMessage` with `source: sightloop-ext|sightloop-page` + nonce.

## Daemon APIs

| Method | Path | Notes |
|---|---|---|
| `POST` | `/v1/sessions` | Creates session **and** writes markup workspace files |
| `POST` | `/v1/sessions/:id/start` | Retrieve-before-act → mock/pi act → verify → temp commit → `awaiting_review` |
| `POST` | `/v1/sessions/:id/review` | `{ decision: accept\|refine\|revert, note? }` |
| `GET` | `/v1/sessions/:id/diff` | Patch vs `git_base_sha` |
| `GET` | `/v1/knowledge` | Distilled knowledge (filters in M4) |
| `GET` | `/v1/admin/metrics` | Basic metrics |
| `GET` | `/v1/admin/audit` | Security audit log |
| `POST` | `/v1/projects/:id/knowledge/sync-agents` | Sync pinned/selected cards into repo `AGENTS.md` |

WS events: `session.status`, `session.step`, `session.awaiting_review`, `session.terminal`, `security.alert`.

## Retrieve dual-loop (M4)

1. `list_knowledge` — **sqlite-vec** similarity over derived embeddings (`local-hash-v1`, dim 256), blended with pin/text overlap. Markdown `knowledge` rows remain source of truth; `knowledge_vec` + `knowledge_vec_map` are the index.
2. `get_latest_annotations` — markup workspace (hard gate; still required before act).
3. Act receives knowledge stub + annotation; Admin timeline shows recall hits (`retrieve: sqlite-vec`).

## Markup dual adapter

- **self (default):** `@sightloop/markup-bridge` reads/writes `YYYY-MM-DD_<slug>_annotations.md` (+ optional png).
- **official:** same workspace contract; optional `npx markup-mcp` probe when `MARKUP_ADAPTER=official` + `MARKUP_MCP_ENABLED=1`.

## Agent runners

- No cloud LLM key → **mock** runner (whitelist-safe edit) so e2e Accept/Refine/Revert still works.
- With `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `SIGHTLOOP_LLM_API_KEY` / `PI_API_KEY` → **pi** runner (`@mariozechner/pi-coding-agent`), falling back to mock if CLI fails.
- `max_steps=5` hard cap; overflow forces `awaiting_review`.
- Per-`repo_path` file lock under `data/locks/`.

## HMR vs PR mode

| Mode | Accept behavior |
|---|---|
| `hmr` | Keep local temp commit; no push |
| `pr` | Keep commit + best-effort `gh pr create` (audited; requires `gh` auth) |

Toggle in Admin → Projects.
