#!/usr/bin/env bash
# Smoke M12d + R4/R8: suspend/resume; bind mismatch 409; GC
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then set -a; # shellcheck disable=SC1091
  source .env; set +a; fi

TOKEN="${SIGHTLOOP_TOKEN:-dev-token-change-me}"
BASE="http://127.0.0.1:7420"
DEMO_PATH="/tmp/sightloop-m12d-demo-$$-$(date +%s)"

rm -rf "$DEMO_PATH" && mkdir -p "$DEMO_PATH/src"
echo "# m12d" > "$DEMO_PATH/README.md"
echo "export const x=1;" > "$DEMO_PATH/src/app.ts"
git -C "$DEMO_PATH" init -q
git -C "$DEMO_PATH" config user.email "sightloop@localhost"
git -C "$DEMO_PATH" config user.name "SightLoop"
git -C "$DEMO_PATH" add -A && git -C "$DEMO_PATH" commit -qm "m12d"

curl -sf -X POST "${BASE}/v1/projects" -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'name':'m12d','repo_path':'${DEMO_PATH}','origin_pattern':'http://127.0.0.1:5175/*',
  'file_whitelist':['src/**'],'mode':'hmr','verify_cmd':'true',
  'acceptance_gate':{'enabled':False,'require_pass_to_accept':False},
}))")" >/tmp/m12d-proj.json
PROJECT_ID="$(python3 -c 'import json;print(json.load(open("/tmp/m12d-proj.json"))["project"]["id"])')"

curl -sf -X POST "${BASE}/v1/sessions" -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'project_id':'${PROJECT_ID}','page_url':'http://127.0.0.1:5175/',
  'sniff':{'framework':'unknown','selector':'[data-testid=x]'},
  'annotation':{'note':'m12d checkpoint','selector':'[data-testid=x]'},
}))")" >/tmp/m12d-sess.json
SESSION_ID="$(python3 -c 'import json;print(json.load(open("/tmp/m12d-sess.json"))["session"]["id"])')"

curl -sf -X POST "${BASE}/v1/sessions/${SESSION_ID}/start" \
  -H "Content-Type: application/json" -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{}' >/tmp/m12d-start.json

# Suspend
curl -sf -X POST "${BASE}/v1/checkpoints" -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'session_id':'${SESSION_ID}','issue_ids':['issue:defer:1'],'note':'pause'
}))")" >/tmp/m12d-cp.json
CP_ID="$(python3 -c 'import json;print(json.load(open("/tmp/m12d-cp.json"))["checkpoint"]["id"])')"

# List
curl -sf "${BASE}/v1/checkpoints?session_id=${SESSION_ID}" -H "X-SightLoop-Token: ${TOKEN}" >/tmp/m12d-list.json
python3 - <<PY
import json
d=json.load(open("/tmp/m12d-list.json"))
assert any(c["id"]=="$CP_ID" for c in d["checkpoints"]), d
print("OK list checkpoint")
PY

# Resume matching bind
curl -sf -X POST "${BASE}/v1/checkpoints/${CP_ID}/resume" \
  -H "Content-Type: application/json" -H "X-SightLoop-Token: ${TOKEN}" \
  -d "{\"session_id\":\"${SESSION_ID}\"}" >/tmp/m12d-resume.json
python3 - <<'PY'
import json
d=json.load(open("/tmp/m12d-resume.json"))
assert d["checkpoint"]["status"]=="resumed"
assert "issue:defer:1" in d["resume"]["issue_ids"]
print("OK resume same issues", d["resume"]["issue_ids"])
PY

# R8: create another project with different path → bind mismatch 409
DEMO2="/tmp/sightloop-m12d-other-$$"
rm -rf "$DEMO2" && mkdir -p "$DEMO2/src"
echo "x" > "$DEMO2/src/app.ts"
git -C "$DEMO2" init -q
git -C "$DEMO2" config user.email "a@b.c"
git -C "$DEMO2" config user.name "t"
git -C "$DEMO2" add -A && git -C "$DEMO2" commit -qm "o"

curl -sf -X POST "${BASE}/v1/projects" -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'name':'m12d-other','repo_path':'${DEMO2}','origin_pattern':'http://127.0.0.1:5175/*',
  'file_whitelist':['src/**'],'mode':'hmr',
  'acceptance_gate':{'enabled':False,'require_pass_to_accept':False},
}))")" >/tmp/m12d-proj2.json
PROJECT2="$(python3 -c 'import json;print(json.load(open("/tmp/m12d-proj2.json"))["project"]["id"])')"
curl -sf -X POST "${BASE}/v1/sessions" -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "{\"project_id\":\"${PROJECT2}\",\"page_url\":\"http://127.0.0.1:5175/\",\"sniff\":{\"framework\":\"unknown\"}}" >/tmp/m12d-sess2.json
SESSION2="$(python3 -c 'import json;print(json.load(open("/tmp/m12d-sess2.json"))["session"]["id"])')"

# New suspended cp on original, try resume with wrong session/project
curl -sf -X POST "${BASE}/v1/checkpoints" -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "{\"session_id\":\"${SESSION_ID}\",\"issue_ids\":[\"y\"]}" >/tmp/m12d-cp2.json
CP2="$(python3 -c 'import json;print(json.load(open("/tmp/m12d-cp2.json"))["checkpoint"]["id"])')"

HTTP=$(curl -s -o /tmp/m12d-bad.json -w '%{http_code}' -X POST \
  "${BASE}/v1/checkpoints/${CP2}/resume" \
  -H "Content-Type: application/json" -H "X-SightLoop-Token: ${TOKEN}" \
  -d "{\"session_id\":\"${SESSION2}\"}")
python3 - <<PY
import json
assert "$HTTP"=="409", ("expected 409", "$HTTP", open("/tmp/m12d-bad.json").read())
print("OK R8 bind mismatch 409")
PY

# GC
curl -sf -X POST "${BASE}/v1/checkpoints/${CP_ID}/consume" \
  -H "X-SightLoop-Token: ${TOKEN}" >/tmp/m12d-consume.json
BEFORE=$(python3 -c 'import json;print(len(json.load(open("/tmp/m12d-list.json"))["checkpoints"]))')
curl -sf -X POST "${BASE}/v1/checkpoints/gc" -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "{\"session_id\":\"${SESSION_ID}\"}" >/tmp/m12d-gc.json
python3 - <<'PY'
import json
d=json.load(open("/tmp/m12d-gc.json"))
assert d["deleted"]>=1, d
print("OK GC deleted", d["deleted"])
PY

echo "SMOKE M12d OK"
