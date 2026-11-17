#!/usr/bin/env bash
# Smoke M4: Admin APIs + knowledge hub + dual-loop recall + AGENTS.md sync
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

TOKEN="${SIGHTLOOP_TOKEN:-dev-token-change-me}"
DEMO_PATH="${SIGHTLOOP_SMOKE_PATH:-/tmp/sightloop-m4-demo-$$-$(date +%s)}"

rm -rf "$DEMO_PATH"
mkdir -p "$DEMO_PATH/src"
echo "# m4 demo" > "$DEMO_PATH/README.md"
echo "export const ready = true;" > "$DEMO_PATH/src/app.ts"
# Whitelist AGENTS.md so sync is allowed
git -C "$DEMO_PATH" init -q
git -C "$DEMO_PATH" config user.email "sightloop@localhost"
git -C "$DEMO_PATH" config user.name "SightLoop"
git -C "$DEMO_PATH" add -A
git -C "$DEMO_PATH" commit -qm "chore: m4 smoke fixture"

echo "== health =="
curl -sf "http://127.0.0.1:7420/health" | tee /tmp/sightloop-m4-health.json
echo
VERSION="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m4-health.json")).get("version",""))')"
echo "VERSION=$VERSION"

echo "== create project (hmr) =="
curl -sf -X POST "http://127.0.0.1:7420/v1/projects" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'name': 'm4-fixture',
  'repo_path': '${DEMO_PATH}',
  'origin_pattern': 'http://localhost:5175/*',
  'file_whitelist': ['src/**', 'AGENTS.md'],
  'mode': 'hmr',
}))")" | tee /tmp/sightloop-m4-project.json
echo
PROJECT_ID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m4-project.json"))["project"]["id"])')"
echo "PROJECT_ID=$PROJECT_ID"

echo "== seed knowledge card (embeds into sqlite-vec) =="
curl -sf -X POST "http://127.0.0.1:7420/v1/knowledge" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'project_id': '${PROJECT_ID}',
  'kind': 'pattern',
  'title': 'ProductCard CTA contrast',
  'body_md': 'Prefer higher-contrast CTA on ProductCard for accessibility.',
  'tags': ['ProductCard', 'cta'],
  'stack': 'react',
  'pinned': True,
}))")" | tee /tmp/sightloop-m4-knowledge-seed.json
echo
KID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m4-knowledge-seed.json"))["knowledge"]["id"])')"
EMB_REF="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m4-knowledge-seed.json"))["knowledge"].get("embedding_ref") or "")')"
echo "EMBEDDING_REF=$EMB_REF"
if [[ "$EMB_REF" != sqlite-vec:* ]]; then
  echo "FAIL: expected embedding_ref sqlite-vec:* (Markdown remains source of truth; vec is derived)"
  exit 1
fi

echo "== create session + start loop (knowledge-before-markup) =="
curl -sf -X POST "http://127.0.0.1:7420/v1/sessions" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'project_id': '${PROJECT_ID}',
  'page_url': 'http://localhost:5175/',
  'sniff': {
    'framework': 'react',
    'componentStack': [{'name': 'ProductCard'}],
    'selector': '[data-testid=\"product-Aurora Lamp\"]',
  },
  'annotation': {
    'note': 'm4 smoke — CTA contrast',
    'selector': '[data-testid=\"product-Aurora Lamp\"]',
  },
}))")" | tee /tmp/sightloop-m4-session.json
echo
SESSION_ID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m4-session.json"))["session"]["id"])')"

curl -sf -X POST "http://127.0.0.1:7420/v1/sessions/${SESSION_ID}/start" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{}' | tee /tmp/sightloop-m4-start.json
echo
STATUS="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m4-start.json"))["session"]["status"])')"
if [[ "$STATUS" != "awaiting_review" ]]; then
  echo "FAIL: expected awaiting_review, got $STATUS"
  exit 1
fi

echo "== session detail: verify knowledge step precedes markup =="
curl -sf "http://127.0.0.1:7420/v1/sessions/${SESSION_ID}" \
  -H "X-SightLoop-Token: ${TOKEN}" | tee /tmp/sightloop-m4-detail.json
echo
python3 - <<'PY'
import json
d=json.load(open("/tmp/sightloop-m4-detail.json"))
steps=d["steps"]
tools=[(s.get("tool_name"), s.get("phase")) for s in steps]
print("TOOLS", tools)
# first retrieve tool should be list_knowledge
retrieve=[s for s in steps if s.get("phase")=="retrieve"]
if not retrieve:
    raise SystemExit("FAIL: no retrieve steps")
if retrieve[0].get("tool_name")!="list_knowledge":
    raise SystemExit(f"FAIL: expected list_knowledge first, got {retrieve[0].get('tool_name')}")
out=retrieve[0].get("output") or {}
hits=out.get("hits") or []
print("KNOWLEDGE_HITS", len(hits), "ENGINE", out.get("engine"))
if len(hits)<1:
    raise SystemExit("FAIL: expected knowledge recall hits visible in Admin timeline")
if out.get("preferred")!="project_knowledge":
    raise SystemExit("FAIL: preferred should be project_knowledge")
if out.get("engine")!="sqlite-vec":
    raise SystemExit(f"FAIL: expected sqlite-vec engine, got {out.get('engine')}")
if not any((h.get("retrieve") or "").find("sqlite-vec")>=0 for h in hits):
    raise SystemExit(f"FAIL: hit retrieve method missing sqlite-vec: {hits}")
# summary persisted for Admin
if not retrieve[0].get("summary"):
    raise SystemExit("FAIL: retrieve step missing summary")
print("OK retrieve order + sqlite-vec recall hits")
PY

echo "== diff =="
curl -sf "http://127.0.0.1:7420/v1/sessions/${SESSION_ID}/diff" \
  -H "X-SightLoop-Token: ${TOKEN}" | tee /tmp/sightloop-m4-diff.json
echo

echo "== accept (distill) =="
curl -sf -X POST "http://127.0.0.1:7420/v1/sessions/${SESSION_ID}/review" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{"decision":"accept"}' | tee /tmp/sightloop-m4-review.json
echo

echo "== knowledge filter / pin / patch =="
curl -sf "http://127.0.0.1:7420/v1/knowledge?project_id=${PROJECT_ID}&stack=react&tag=ProductCard" \
  -H "X-SightLoop-Token: ${TOKEN}" | tee /tmp/sightloop-m4-knowledge-list.json
echo
curl -sf -X PATCH "http://127.0.0.1:7420/v1/knowledge/${KID}" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{"pinned":true,"tags":["ProductCard","cta","m4"]}' >/tmp/sightloop-m4-knowledge-patch.json

echo "== AGENTS.md dry-run + write =="
curl -sf -X POST "http://127.0.0.1:7420/v1/projects/${PROJECT_ID}/knowledge/sync-agents" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "{\"knowledge_ids\":[\"${KID}\"],\"dry_run\":true}" | tee /tmp/sightloop-m4-sync-dry.json
echo
curl -sf -X POST "http://127.0.0.1:7420/v1/projects/${PROJECT_ID}/knowledge/sync-agents" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "{\"knowledge_ids\":[\"${KID}\"],\"dry_run\":false}" | tee /tmp/sightloop-m4-sync.json
echo
if [[ ! -f "$DEMO_PATH/AGENTS.md" ]]; then
  echo "FAIL: AGENTS.md was not written"
  exit 1
fi
grep -q "sightloop:knowledge:begin" "$DEMO_PATH/AGENTS.md"
grep -q "ProductCard CTA contrast" "$DEMO_PATH/AGENTS.md"
echo "AGENTS.md OK"

echo "== project mode toggle to pr =="
curl -sf -X PATCH "http://127.0.0.1:7420/v1/projects/${PROJECT_ID}" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{"mode":"pr"}' | tee /tmp/sightloop-m4-mode.json
echo
MODE="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m4-mode.json"))["project"]["mode"])')"
if [[ "$MODE" != "pr" ]]; then
  echo "FAIL: expected mode=pr"
  exit 1
fi

echo "== metrics + audit =="
curl -sf "http://127.0.0.1:7420/v1/admin/metrics" \
  -H "X-SightLoop-Token: ${TOKEN}" | tee /tmp/sightloop-m4-metrics.json
echo
curl -sf "http://127.0.0.1:7420/v1/admin/audit?project_id=${PROJECT_ID}&limit=50" \
  -H "X-SightLoop-Token: ${TOKEN}" | tee /tmp/sightloop-m4-audit.json
echo
python3 - <<'PY'
import json
m=json.load(open("/tmp/sightloop-m4-metrics.json"))["metrics"]
assert m["sessions_total"] >= 1
assert m["knowledge_total"] >= 1
assert m.get("vec_ready") is True, m
assert (m.get("vec_indexed") or 0) >= 1, m
a=json.load(open("/tmp/sightloop-m4-audit.json"))["audit"]
events={e["event"] for e in a}
print("AUDIT_EVENTS", sorted(events))
assert "agents_md_synced" in events or "agents_md_sync_preview" in events
assert "knowledge_created" in events or "knowledge_updated" in events
print("OK metrics+audit+sqlite-vec")
PY

echo "OK — M4 smoke passed"
echo "Admin UI: pnpm dev:admin → http://127.0.0.1:5173"
