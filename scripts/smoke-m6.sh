#!/usr/bin/env bash
# Smoke M6: session read-model (diff_summary/timeline/recall) + Accept distilled_knowledge
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
BASE="http://127.0.0.1:7420"
DEMO_PATH="${SIGHTLOOP_SMOKE_PATH:-/tmp/sightloop-m6-demo-$$-$(date +%s)}"

rm -rf "$DEMO_PATH"
mkdir -p "$DEMO_PATH/src"
echo "# m6" > "$DEMO_PATH/README.md"
echo "export const ready = true;" > "$DEMO_PATH/src/app.ts"
git -C "$DEMO_PATH" init -q
git -C "$DEMO_PATH" config user.email "sightloop@localhost"
git -C "$DEMO_PATH" config user.name "SightLoop"
git -C "$DEMO_PATH" add -A
git -C "$DEMO_PATH" commit -qm "chore: m6 smoke"

echo "== health =="
curl -sf "${BASE}/health" | tee /tmp/sightloop-m6-health.json
echo
VERSION="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m6-health.json")).get("version",""))')"
echo "VERSION=$VERSION"

echo "== seed knowledge + project =="
curl -sf -X POST "${BASE}/v1/projects" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'name': 'm6-fixture',
  'repo_path': '${DEMO_PATH}',
  'origin_pattern': 'http://localhost:5175/*',
  'file_whitelist': ['src/**'],
  'mode': 'hmr',
}))")" | tee /tmp/sightloop-m6-project.json
echo
PROJECT_ID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m6-project.json"))["project"]["id"])')"

curl -sf -X POST "${BASE}/v1/knowledge" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'project_id': '${PROJECT_ID}',
  'kind': 'pattern',
  'title': 'ProductCard CTA contrast',
  'body_md': 'Prefer higher-contrast CTA on ProductCard.',
  'tags': ['ProductCard','cta'],
  'stack': 'react',
  'pinned': True,
}))")" >/tmp/sightloop-m6-knowledge.json

echo "== session + start =="
curl -sf -X POST "${BASE}/v1/sessions" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'project_id': '${PROJECT_ID}',
  'page_url': 'http://localhost:5175/',
  'sniff': {'framework':'react','componentStack':[{'name':'ProductCard'}]},
  'annotation': {'note':'m6 smoke CTA','selector':'[data-testid=product]'},
}))")" | tee /tmp/sightloop-m6-session.json
echo
SESSION_ID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m6-session.json"))["session"]["id"])')"

curl -sf -X POST "${BASE}/v1/sessions/${SESSION_ID}/start" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{}' | tee /tmp/sightloop-m6-start.json
echo
STATUS="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m6-start.json"))["session"]["status"])')"
[[ "$STATUS" == "awaiting_review" ]] || { echo "FAIL status=$STATUS"; exit 1; }

echo "== session read-model =="
curl -sf "${BASE}/v1/sessions/${SESSION_ID}" \
  -H "X-SightLoop-Token: ${TOKEN}" | tee /tmp/sightloop-m6-detail.json
echo
python3 - <<'PY'
import json
d=json.load(open("/tmp/sightloop-m6-detail.json"))
assert "timeline" in d and len(d["timeline"])>=1, d.keys()
assert "diff_summary" in d and d["diff_summary"] and d["diff_summary"].get("files"), d.get("diff_summary")
assert "recall_hits" in d and len(d["recall_hits"])>=1, d.get("recall_hits")
assert d["recall_hits"][0].get("title")
# verify may be null when no verify_cmd — that's OK
assert "verify" in d
kinds={e.get("kind") for e in d["timeline"]}
print("timeline_kinds", sorted(kinds))
print("diff_files", [f["path"] for f in d["diff_summary"]["files"]])
print("recall", d["recall_hits"][0]["title"])
print("OK read-model")
PY

echo "== diff summary field =="
curl -sf "${BASE}/v1/sessions/${SESSION_ID}/diff" \
  -H "X-SightLoop-Token: ${TOKEN}" | tee /tmp/sightloop-m6-diff.json
echo
python3 - <<'PY'
import json
d=json.load(open("/tmp/sightloop-m6-diff.json"))
assert d.get("patch")
assert d.get("summary") and d["summary"].get("files")
print("OK diff.summary")
PY

echo "== refine then poll awaiting_review =="
curl -sf -X POST "${BASE}/v1/sessions/${SESSION_ID}/review" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{"decision":"refine","note":"m6 refine note — tweak CTA"}' \
  | tee /tmp/sightloop-m6-refine.json
echo
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  sleep 0.4
  curl -sf "${BASE}/v1/sessions/${SESSION_ID}" -H "X-SightLoop-Token: ${TOKEN}" > /tmp/sightloop-m6-poll.json
  ST="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m6-poll.json"))["session"]["status"])')"
  echo "poll=$ST"
  if [[ "$ST" == "awaiting_review" || "$ST" == "failed" ]]; then
    break
  fi
done
python3 - <<'PY'
import json
d=json.load(open("/tmp/sightloop-m6-poll.json"))
assert d["session"]["status"]=="awaiting_review", d["session"]["status"]
labels=[e.get("label","") for e in d["timeline"]]
assert any("refine" in (e.get("kind") or "") or "refine" in (e.get("label") or "") for e in d["timeline"]), labels
print("OK refine timeline")
PY

echo "== accept → distilled_knowledge =="
curl -sf -X POST "${BASE}/v1/sessions/${SESSION_ID}/review" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{"decision":"accept"}' | tee /tmp/sightloop-m6-accept.json
echo
python3 - <<'PY'
import json
d=json.load(open("/tmp/sightloop-m6-accept.json"))
assert d["session"]["status"]=="accepted"
dk=d.get("distilled_knowledge")
assert dk and dk.get("id") and dk.get("title") and dk.get("body_preview"), dk
assert d.get("timeline")
print("distilled", dk["id"], dk["title"])
print("OK accept distilled_knowledge")
PY

curl -sf "${BASE}/v1/sessions/${SESSION_ID}" -H "X-SightLoop-Token: ${TOKEN}" > /tmp/sightloop-m6-final.json
python3 - <<'PY'
import json
d=json.load(open("/tmp/sightloop-m6-final.json"))
assert d.get("latest_knowledge") and d["latest_knowledge"]["id"]
print("OK latest_knowledge on session read-model")
PY

echo "OK — M6 smoke passed"
echo "Demo: run fixture + extension; at awaiting_review open 验收 drawer (Diff/Verify/Recall/Timeline); Accept shows distilled card."
