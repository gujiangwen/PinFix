#!/usr/bin/env bash
# Smoke M10b: dual-loop plan visible + PATCH editable under whitelist
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
DEMO_PATH="${SIGHTLOOP_SMOKE_PATH:-/tmp/sightloop-m10b-demo-$$-$(date +%s)}"

rm -rf "$DEMO_PATH"
mkdir -p "$DEMO_PATH/src"
echo "# m10b" > "$DEMO_PATH/README.md"
echo "export const ready = true;" > "$DEMO_PATH/src/app.ts"
git -C "$DEMO_PATH" init -q
git -C "$DEMO_PATH" config user.email "sightloop@localhost"
git -C "$DEMO_PATH" config user.name "SightLoop"
git -C "$DEMO_PATH" add -A
git -C "$DEMO_PATH" commit -qm "chore: m10b smoke"

echo "== require dual_loop =="
python3 - <<'PY'
import os
assert os.environ.get("SIGHTLOOP_DUAL_LOOP") in ("1", "true")
print("OK DUAL_LOOP=1")
PY

curl -sf -X POST "${BASE}/v1/projects" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'name': 'm10b-fixture',
  'repo_path': '${DEMO_PATH}',
  'origin_pattern': 'http://127.0.0.1:5175/*',
  'file_whitelist': ['src/**'],
  'mode': 'hmr',
  'acceptance_gate': {'enabled': False, 'require_pass_to_accept': False},
}))")" | tee /tmp/sightloop-m10b-project.json >/dev/null
PROJECT_ID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m10b-project.json"))["project"]["id"])')"

curl -sf -X POST "${BASE}/v1/sessions" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'project_id': '${PROJECT_ID}',
  'page_url': 'http://127.0.0.1:5175/',
  'sniff': {'framework':'unknown','selector':'[data-testid=x]'},
  'annotation': {'note':'m10b plan edit','selector':'[data-testid=x]'},
}))")" | tee /tmp/sightloop-m10b-session.json >/dev/null
SESSION_ID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m10b-session.json"))["session"]["id"])')"

curl -sf -X POST "${BASE}/v1/sessions/${SESSION_ID}/start" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{}' | tee /tmp/sightloop-m10b-start.json >/dev/null
python3 - <<'PY'
import json
s=json.load(open("/tmp/sightloop-m10b-start.json"))["session"]
assert s["status"]=="awaiting_review", s["status"]
print("OK awaiting_review")
PY

curl -sf "${BASE}/v1/sessions/${SESSION_ID}" \
  -H "X-SightLoop-Token: ${TOKEN}" | tee /tmp/sightloop-m10b-get.json >/dev/null
python3 - <<'PY'
import json
d=json.load(open("/tmp/sightloop-m10b-get.json"))
assert d.get("plan") and d["plan"].get("allowed_files"), d.get("plan")
assert "agent_review" in d
print("OK session includes plan", d["plan"]["allowed_files"])
PY

curl -sf -X PATCH "${BASE}/v1/sessions/${SESSION_ID}/plan" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{"root_cause":"human edited root","allowed_files":["src/app.ts","/etc/passwd","README.md"]}' \
  | tee /tmp/sightloop-m10b-patch.json
echo
python3 - <<'PY'
import json
plan=json.load(open("/tmp/sightloop-m10b-patch.json"))["plan"]
assert plan["root_cause"]=="human edited root"
assert plan["allowed_files"]==["src/app.ts"], plan["allowed_files"]
print("OK PATCH filtered whitelist", plan["allowed_files"])
PY

curl -sf "${BASE}/v1/sessions/${SESSION_ID}/plan" \
  -H "X-SightLoop-Token: ${TOKEN}" | tee /tmp/sightloop-m10b-plan.json >/dev/null
python3 - <<'PY'
import json
plan=json.load(open("/tmp/sightloop-m10b-plan.json"))["plan"]
assert plan["allowed_files"]==["src/app.ts"]
print("OK GET plan persisted")
PY

echo
echo "SMOKE M10b OK"
echo "SESSION_ID=$SESSION_ID"
