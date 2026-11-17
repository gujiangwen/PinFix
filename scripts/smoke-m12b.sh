#!/usr/bin/env bash
# Smoke M12b + R2: edit evidence auto-bind pass; forbid_auto → edit_without_evidence
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then set -a; # shellcheck disable=SC1091
  source .env; set +a; fi

TOKEN="${SIGHTLOOP_TOKEN:-dev-token-change-me}"
BASE="http://127.0.0.1:7420"

python3 - <<'PY'
import os
assert os.environ.get("SIGHTLOOP_DUAL_LOOP") in ("1","true")
# ensure forbid off for first path
assert os.environ.get("SIGHTLOOP_FORBID_EDIT_EVIDENCE","0") not in ("1","true")
print("OK dual_loop evidence auto-bind path")
PY

DEMO_PATH="/tmp/sightloop-m12b-demo-$$-$(date +%s)"
rm -rf "$DEMO_PATH" && mkdir -p "$DEMO_PATH/src"
echo "# m12b" > "$DEMO_PATH/README.md"
echo "export const x=1;" > "$DEMO_PATH/src/app.ts"
git -C "$DEMO_PATH" init -q
git -C "$DEMO_PATH" config user.email "sightloop@localhost"
git -C "$DEMO_PATH" config user.name "SightLoop"
git -C "$DEMO_PATH" add -A && git -C "$DEMO_PATH" commit -qm "m12b"

curl -sf -X POST "${BASE}/v1/projects" -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'name':'m12b','repo_path':'${DEMO_PATH}','origin_pattern':'http://127.0.0.1:5175/*',
  'file_whitelist':['src/**'],'mode':'hmr','verify_cmd':'true',
  'acceptance_gate':{'enabled':False,'require_pass_to_accept':False},
}))")" >/tmp/m12b-proj.json
PROJECT_ID="$(python3 -c 'import json;print(json.load(open("/tmp/m12b-proj.json"))["project"]["id"])')"

curl -sf -X POST "${BASE}/v1/sessions" -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'project_id':'${PROJECT_ID}','page_url':'http://127.0.0.1:5175/',
  'sniff':{'selector':'[data-testid=x]'},
  'annotation':{'note':'m12b evidence','selector':'[data-testid=x]'},
}))")" >/tmp/m12b-sess.json
SESSION_ID="$(python3 -c 'import json;print(json.load(open("/tmp/m12b-sess.json"))["session"]["id"])')"

curl -sf -X POST "${BASE}/v1/sessions/${SESSION_ID}/start" \
  -H "Content-Type: application/json" -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{}' >/tmp/m12b-start.json

curl -sf "${BASE}/v1/sessions/${SESSION_ID}" -H "X-SightLoop-Token: ${TOKEN}" >/tmp/m12b-get.json
python3 - <<'PY'
import json
s=json.load(open("/tmp/m12b-start.json"))["session"]
assert s["status"]=="awaiting_review", s["status"]
body=json.load(open("/tmp/m12b-get.json"))
steps=body.get("steps") or []
ev=False
for st in steps:
  out=st.get("output") or {}
  if isinstance(out, dict) and out.get("edit_evidence"):
    for e in out["edit_evidence"]:
      assert e.get("evidence_refs"), e
    ev=True
assert ev, "expected edit_evidence auto-bound on act"
print("OK auto-bind evidence")
# unit-level forbid path covered in m12.test.ts R2
print("OK forbid/unmet covered by unit R2")
PY

echo "SMOKE M12b OK SESSION=$SESSION_ID"
