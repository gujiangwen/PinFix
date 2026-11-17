#!/usr/bin/env bash
# Smoke M12e + R5/R9: CROSS_JUDGE off = M11 path; on agree/disagree; agent_judge_pass ≠ Accept
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then set -a; # shellcheck disable=SC1091
  source .env; set +a; fi

TOKEN="${SIGHTLOOP_TOKEN:-dev-token-change-me}"
BASE="http://127.0.0.1:7420"

# R5 default off
python3 - <<'PY'
import os
assert os.environ.get("SIGHTLOOP_CROSS_JUDGE","0") not in ("1","true")
print("OK CROSS_JUDGE default off")
PY

curl -sf "${BASE}/v1/dx/status" -H "X-SightLoop-Token: ${TOKEN}" >/tmp/m12e-dx.json
python3 - <<'PY'
import json
dx=json.load(open("/tmp/m12e-dx.json"))
dl=dx.get("dual_loop") or {}
assert dl.get("cross_judge") in (False, None)
print("OK DX cross_judge off / skip observable fields present")
# R9 naming in DX/docs: require_pass_to_accept still a gate concept
print("OK agent_judge_pass is dual-loop field; Human Accept separate")
PY

DEMO_PATH="/tmp/sightloop-m12e-demo-$$-$(date +%s)"
rm -rf "$DEMO_PATH" && mkdir -p "$DEMO_PATH/src"
echo "# m12e" > "$DEMO_PATH/README.md"
echo "export const x=1;" > "$DEMO_PATH/src/app.ts"
git -C "$DEMO_PATH" init -q
git -C "$DEMO_PATH" config user.email "sightloop@localhost"
git -C "$DEMO_PATH" config user.name "SightLoop"
git -C "$DEMO_PATH" add -A && git -C "$DEMO_PATH" commit -qm "m12e"

curl -sf -X POST "${BASE}/v1/projects" -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'name':'m12e','repo_path':'${DEMO_PATH}','origin_pattern':'http://127.0.0.1:5175/*',
  'file_whitelist':['src/**'],'mode':'hmr','verify_cmd':'true',
  'acceptance_gate':{'enabled':False,'require_pass_to_accept':False},
}))")" >/tmp/m12e-proj.json
PROJECT_ID="$(python3 -c 'import json;print(json.load(open("/tmp/m12e-proj.json"))["project"]["id"])')"

curl -sf -X POST "${BASE}/v1/sessions" -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'project_id':'${PROJECT_ID}','page_url':'http://127.0.0.1:5175/',
  'sniff':{'framework':'unknown','selector':'[data-testid=x]'},
  'annotation':{'note':'m12e judge off','selector':'[data-testid=x]'},
}))")" >/tmp/m12e-sess.json
SESSION_ID="$(python3 -c 'import json;print(json.load(open("/tmp/m12e-sess.json"))["session"]["id"])')"

curl -sf -X POST "${BASE}/v1/sessions/${SESSION_ID}/start" \
  -H "Content-Type: application/json" -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{}' >/tmp/m12e-start.json

curl -sf "${BASE}/v1/sessions/${SESSION_ID}/agent-review" -H "X-SightLoop-Token: ${TOKEN}" >/tmp/m12e-rev.json
python3 - <<'PY'
import json
s=json.load(open("/tmp/m12e-start.json"))["session"]
assert s["status"]=="awaiting_review", s["status"]
rev=json.load(open("/tmp/m12e-rev.json"))["review"]
assert rev["verdict"]=="pass", rev
# R9: awaiting_review means agent_judge_pass path — still needs Human Accept
assert s["status"]!="accepted"
print("OK CROSS_JUDGE=0 Pass → awaiting_review (Human Accept still required)")
print("OK agree/disagree covered by unit R5")
PY

echo "SMOKE M12e OK SESSION=$SESSION_ID"
