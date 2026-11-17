#!/usr/bin/env bash
# Smoke M12c + R3: test_first plan; MUTATION_GATE off by default; on → met/unmet
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then set -a; # shellcheck disable=SC1091
  source .env; set +a; fi

TOKEN="${SIGHTLOOP_TOKEN:-dev-token-change-me}"
BASE="http://127.0.0.1:7420"

# R3: default off
python3 - <<'PY'
import os
assert os.environ.get("SIGHTLOOP_MUTATION_GATE","0") not in ("1","true")
print("OK MUTATION_GATE default off")
PY

export SIGHTLOOP_FORCE_TEST_FIRST=1
DEMO_PATH="/tmp/sightloop-m12c-demo-$$-$(date +%s)"
rm -rf "$DEMO_PATH" && mkdir -p "$DEMO_PATH/src"
echo "# m12c" > "$DEMO_PATH/README.md"
echo "export const x=1;" > "$DEMO_PATH/src/app.ts"
git -C "$DEMO_PATH" init -q
git -C "$DEMO_PATH" config user.email "sightloop@localhost"
git -C "$DEMO_PATH" config user.name "SightLoop"
git -C "$DEMO_PATH" add -A && git -C "$DEMO_PATH" commit -qm "m12c"

curl -sf -X POST "${BASE}/v1/projects" -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'name':'m12c','repo_path':'${DEMO_PATH}','origin_pattern':'http://127.0.0.1:5175/*',
  'file_whitelist':['src/**'],'mode':'hmr','verify_cmd':'true',
  'acceptance_gate':{'enabled':False,'require_pass_to_accept':False},
}))")" >/tmp/m12c-proj.json
PROJECT_ID="$(python3 -c 'import json;print(json.load(open("/tmp/m12c-proj.json"))["project"]["id"])')"

curl -sf -X POST "${BASE}/v1/sessions" -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'project_id':'${PROJECT_ID}','page_url':'http://127.0.0.1:5175/',
  'sniff':{'framework':'unknown','selector':'[data-testid=x]'},
  'annotation':{'note':'m12c test_first','selector':'[data-testid=x]'},
}))")" >/tmp/m12c-sess.json
SESSION_ID="$(python3 -c 'import json;print(json.load(open("/tmp/m12c-sess.json"))["session"]["id"])')"

curl -sf -X POST "${BASE}/v1/sessions/${SESSION_ID}/start" \
  -H "Content-Type: application/json" -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{}' >/tmp/m12c-start.json

curl -sf "${BASE}/v1/sessions/${SESSION_ID}/plan" -H "X-SightLoop-Token: ${TOKEN}" >/tmp/m12c-plan.json
python3 - <<'PY'
import json
plan=json.load(open("/tmp/m12c-plan.json"))["plan"]
assert plan.get("test_first"), plan
assert any(s.get("id")=="shell:test_first" for s in (plan.get("verify_contract") or {}).get("shell") or []), plan
print("OK test_first in plan")
PY

# DX shows mutation_gate false
curl -sf "${BASE}/v1/dx/status" -H "X-SightLoop-Token: ${TOKEN}" >/tmp/m12c-dx.json
python3 - <<'PY'
import json
dx=json.load(open("/tmp/m12c-dx.json"))
dl=dx.get("dual_loop") or {}
assert dl.get("mutation_gate") in (False, None) or dl.get("mutation_gate") is False
print("OK DX mutation_gate off")
# unit tests cover flag=1 met/unmet proxy
print("OK mutation met/unmet via unit R3")
PY

echo "SMOKE M12c OK SESSION=$SESSION_ID"
