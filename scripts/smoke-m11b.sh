#!/usr/bin/env bash
# Smoke M11b: PlanIR.verify_contract required; Pass carries pass_evidence
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then set -a; # shellcheck disable=SC1091
  source .env; set +a; fi

TOKEN="${SIGHTLOOP_TOKEN:-dev-token-change-me}"
BASE="http://127.0.0.1:7420"
DEMO_PATH="/tmp/sightloop-m11b-demo-$$-$(date +%s)"

python3 - <<'PY'
import os
assert os.environ.get("SIGHTLOOP_DUAL_LOOP") in ("1","true")
# no force refine — clean pass path
print("OK dual_loop")
PY

rm -rf "$DEMO_PATH" && mkdir -p "$DEMO_PATH/src"
echo "# m11b" > "$DEMO_PATH/README.md"
echo "export const x=1;" > "$DEMO_PATH/src/app.ts"
git -C "$DEMO_PATH" init -q
git -C "$DEMO_PATH" config user.email "sightloop@localhost"
git -C "$DEMO_PATH" config user.name "SightLoop"
git -C "$DEMO_PATH" add -A && git -C "$DEMO_PATH" commit -qm "m11b"

curl -sf -X POST "${BASE}/v1/projects" -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'name':'m11b','repo_path':'${DEMO_PATH}','origin_pattern':'http://127.0.0.1:5175/*',
  'file_whitelist':['src/**'],'mode':'hmr','verify_cmd':'true',
  'acceptance_gate':{'enabled':False,'require_pass_to_accept':False},
}))")" >/tmp/m11b-proj.json
PROJECT_ID="$(python3 -c 'import json;print(json.load(open("/tmp/m11b-proj.json"))["project"]["id"])')"

curl -sf -X POST "${BASE}/v1/sessions" -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'project_id':'${PROJECT_ID}','page_url':'http://127.0.0.1:5175/',
  'sniff':{'framework':'unknown'},
  'annotation':{'note':'m11b contract','selector':'[data-testid=x]'},
}))")" >/tmp/m11b-sess.json
SESSION_ID="$(python3 -c 'import json;print(json.load(open("/tmp/m11b-sess.json"))["session"]["id"])')"

# Ensure FORCE_REFINE is off for this smoke
curl -sf -X POST "${BASE}/v1/sessions/${SESSION_ID}/start" \
  -H "Content-Type: application/json" -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{}' >/tmp/m11b-start.json

curl -sf "${BASE}/v1/sessions/${SESSION_ID}" -H "X-SightLoop-Token: ${TOKEN}" >/tmp/m11b-get.json
curl -sf "${BASE}/v1/sessions/${SESSION_ID}/plan" -H "X-SightLoop-Token: ${TOKEN}" >/tmp/m11b-plan.json
curl -sf "${BASE}/v1/sessions/${SESSION_ID}/agent-review" -H "X-SightLoop-Token: ${TOKEN}" >/tmp/m11b-review.json

python3 - <<'PY'
import json
s=json.load(open("/tmp/m11b-start.json"))["session"]
assert s["status"]=="awaiting_review", s["status"]
plan=json.load(open("/tmp/m11b-plan.json"))["plan"]
assert plan and plan.get("verify_contract"), plan
assert plan["verify_contract"].get("shell"), plan["verify_contract"]
rev=json.load(open("/tmp/m11b-review.json"))["review"]
assert rev and rev["verdict"]=="pass", rev
assert rev.get("pass_evidence"), rev
ids={e["contract_item_id"] for e in rev["pass_evidence"]}
for item in plan["verify_contract"]["shell"]:
    assert item["id"] in ids, (item["id"], ids)
print("OK verify_contract + pass_evidence", list(ids))
PY

echo "SMOKE M11b OK SESSION=$SESSION_ID"
