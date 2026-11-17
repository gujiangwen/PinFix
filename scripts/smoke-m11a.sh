#!/usr/bin/env bash
# Smoke M11a: RefineIR on reviewer refine; next plan has issue_resolutions
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then set -a; # shellcheck disable=SC1091
  source .env; set +a; fi

TOKEN="${SIGHTLOOP_TOKEN:-dev-token-change-me}"
BASE="http://127.0.0.1:7420"
DEMO_PATH="/tmp/sightloop-m11a-demo-$$-$(date +%s)"

python3 - <<'PY'
import os
assert os.environ.get("SIGHTLOOP_DUAL_LOOP") in ("1", "true")
assert os.environ.get("SIGHTLOOP_DUAL_LOOP_FORCE_REFINE") in ("1", "true")
print("OK env dual_loop+force_refine")
PY

rm -rf "$DEMO_PATH" && mkdir -p "$DEMO_PATH/src"
echo "# m11a" > "$DEMO_PATH/README.md"
echo "export const x=1;" > "$DEMO_PATH/src/app.ts"
git -C "$DEMO_PATH" init -q
git -C "$DEMO_PATH" config user.email "sightloop@localhost"
git -C "$DEMO_PATH" config user.name "SightLoop"
git -C "$DEMO_PATH" add -A && git -C "$DEMO_PATH" commit -qm "m11a"

curl -sf -X POST "${BASE}/v1/projects" -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'name':'m11a','repo_path':'${DEMO_PATH}','origin_pattern':'http://127.0.0.1:5175/*',
  'file_whitelist':['src/**'],'mode':'hmr',
  'acceptance_gate':{'enabled':False,'require_pass_to_accept':False},
}))")" >/tmp/m11a-proj.json
PROJECT_ID="$(python3 -c 'import json;print(json.load(open("/tmp/m11a-proj.json"))["project"]["id"])')"

curl -sf -X POST "${BASE}/v1/sessions" -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'project_id':'${PROJECT_ID}','page_url':'http://127.0.0.1:5175/',
  'sniff':{'framework':'unknown','selector':'[data-testid=x]'},
  'annotation':{'note':'m11a refine','selector':'[data-testid=x]'},
}))")" >/tmp/m11a-sess.json
SESSION_ID="$(python3 -c 'import json;print(json.load(open("/tmp/m11a-sess.json"))["session"]["id"])')"

curl -sf -X POST "${BASE}/v1/sessions/${SESSION_ID}/start" \
  -H "Content-Type: application/json" -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{}' >/tmp/m11a-start.json

curl -sf "${BASE}/v1/sessions/${SESSION_ID}" \
  -H "X-SightLoop-Token: ${TOKEN}" >/tmp/m11a-get.json

python3 - <<'PY'
import json
s=json.load(open("/tmp/m11a-start.json"))["session"]
assert s["status"]=="awaiting_review", s["status"]
body=json.load(open("/tmp/m11a-get.json"))
steps=body.get("steps") or []
phases=[st.get("phase") for st in steps]
assert phases.count("plan")>=2, phases
assert phases.count("review")>=2, phases
refine_seen=False
resolutions_seen=False
for st in steps:
  out=st.get("output") or {}
  if not isinstance(out, dict):
    continue
  ri=out.get("refine_ir")
  if isinstance(ri, dict) and ri.get("blocking_issues"):
    refine_seen=True
  if out.get("issue_resolutions"):
    resolutions_seen=True
assert refine_seen, "expected refine_ir in step outputs"
assert resolutions_seen, "expected issue_resolutions on subsequent plan"
plan=body.get("plan") or {}
assert plan.get("verify_contract"), plan
print("OK RefineIR + issue_resolutions + verify_contract")
PY

echo "SMOKE M11a OK SESSION=$SESSION_ID"
