# SightLoop architecture

**M1:** Daemon Project Registry + SQLite + minimal Admin.

**M2:** Chrome MV3 extension (Shadow DOM pick UI) + `@sightloop/sniff` (React → Vue3 → DOM) + `POST /v1/sessions` + WebSocket status subscribe + React fixture app.

**M3:** Markup dual-adapter + Agent Loop (retrieve → act → verify → temp commit) + Accept / Refine / Revert + Distill-on-Accept.

## Extension worlds

| Script | World | Role |
|---|---|---|
| `background` | Extension SW | Daemon REST/WS, settings, session create/start/review |
| `content` | Isolated | Closed Shadow DOM toolbar, pick highlight, annotation bubble, review buttons |
| `injected` | Main (`world: MAIN`) | Runs `@sightloop/sniff` against page Fiber/Vue expandos |

Bridge: `window.postMessage` with `source: sightloop-ext|sightloop-page` + nonce.

## Daemon APIs (M3)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/v1/sessions` | Creates session **and** writes markup workspace files |
| `POST` | `/v1/sessions/:id/start` | Retrieve-before-act → mock/pi act → verify → temp commit → `awaiting_review` |
| `POST` | `/v1/sessions/:id/review` | `{ decision: accept\|refine\|revert, note? }` |
| `GET` | `/v1/sessions/:id/diff` | Patch vs `git_base_sha` |
| `GET` | `/v1/knowledge?project_id=` | Distilled knowledge rows |

WS events: `session.status`, `session.step`, `session.awaiting_review`, `session.terminal`, `security.alert`.

## Markup dual adapter

- **self (default):** `@sightloop/markup-bridge` reads/writes `YYYY-MM-DD_<slug>_annotations.md` (+ optional png).
- **official:** same workspace contract; optional `npx markup-mcp` probe when `MARKUP_ADAPTER=official` + `MARKUP_MCP_ENABLED=1`.

## Agent runners

- No cloud LLM key → **mock** runner (whitelist-safe edit) so e2e Accept/Refine/Revert still works.
- With `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `SIGHTLOOP_LLM_API_KEY` / `PI_API_KEY` → **pi** runner (`@mariozechner/pi-coding-agent`), falling back to mock if CLI fails.
- `max_steps=5` hard cap; overflow forces `awaiting_review`.
- Per-`repo_path` file lock under `data/locks/`.
