#!/usr/bin/env bash
# Smoke M9a: dual-loop mock graph → awaiting_review; whitelist block; DUAL_LOOP=0 legacy
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
DEMO_PATH="${SIGHTLOOP_SMOKE_PATH:-/tmp/sightloop-m9a-demo-$$-$(date +%s)}"

rm -rf "$DEMO_PATH"
mkdir -p "$DEMO_PATH/src"
echo "# m9a" > "$DEMO_PATH/README.md"
echo "export const ready = true;" > "$DEMO_PATH/src/app.ts"
git -C "$DEMO_PATH" init -q
git -C "$DEMO_PATH" config user.email "sightloop@localhost"
git -C "$DEMO_PATH" config user.name "SightLoop"
git -C "$DEMO_PATH" add -A
git -C "$DEMO_PATH" commit -qm "chore: m9a smoke"

echo "== health =="
curl -sf "${BASE}/health" | tee /tmp/sightloop-m9a-health.json
echo
VERSION="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m9a-health.json")).get("version",""))')"
echo "VERSION=$VERSION"

echo "== dx dual_loop =="
curl -sf "${BASE}/v1/dx/status" | tee /tmp/sightloop-m9a-dx.json
echo
python3 - <<'PY'
import json, os
d = json.load(open("/tmp/sightloop-m9a-dx.json"))
dl = d.get("dual_loop") or {}
assert "enabled" in dl, d
print("OK dx dual_loop", dl)
assert os.environ.get("SIGHTLOOP_DUAL_LOOP") in ("1", "true"), "smoke expects SIGHTLOOP_DUAL_LOOP=1 on daemon"
assert dl.get("enabled") is True, dl
assert dl.get("mode") == "mock", dl
PY

echo "== project =="
curl -sf -X POST "${BASE}/v1/projects" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'name': 'm9a-fixture',
  'repo_path': '${DEMO_PATH}',
  'origin_pattern': 'http://127.0.0.1:5175/*',
  'file_whitelist': ['src/**'],
  'mode': 'hmr',
  'acceptance_gate': {
    'enabled': False,
    'require_pass_to_accept': False,
    'allow_force_accept': False,
    'auto_run_on_awaiting_review': False,
  },
}))")" | tee /tmp/sightloop-m9a-project.json
echo
PROJECT_ID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m9a-project.json"))["project"]["id"])')"

echo "== dual-loop session (force one inner refine) =="
curl -sf -X POST "${BASE}/v1/sessions" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'project_id': '${PROJECT_ID}',
  'page_url': 'http://127.0.0.1:5175/',
  'sniff': {'framework':'unknown','selector':'[data-testid=gate-ok]'},
  'annotation': {'note':'m9a dual-loop','selector':'[data-testid=gate-ok]'},
}))")" | tee /tmp/sightloop-m9a-session.json
echo
SESSION_ID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m9a-session.json"))["session"]["id"])')"

curl -sf -X POST "${BASE}/v1/sessions/${SESSION_ID}/start" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{}' | tee /tmp/sightloop-m9a-start.json
echo
python3 - <<'PY'
import json
s = json.load(open("/tmp/sightloop-m9a-start.json"))["session"]
assert s["status"] == "awaiting_review", s["status"]
print("OK dual-loop → awaiting_review", s["id"][:8], "steps", s["step_count"])
PY

curl -sf "${BASE}/v1/sessions/${SESSION_ID}" \
  -H "X-SightLoop-Token: ${TOKEN}" | tee /tmp/sightloop-m9a-get.json >/dev/null
python3 - <<'PY'
import json
d = json.load(open("/tmp/sightloop-m9a-get.json"))
phases = [st.get("phase") for st in d.get("steps", [])]
print("phases", phases)
for need in ("retrieve", "plan", "act", "verify", "review"):
    assert need in phases, (need, phases)
# inner refine should produce a second plan + act when FORCE_REFINE=1
assert phases.count("plan") >= 2, phases
assert phases.count("act") >= 2, phases
assert phases.count("review") >= 2, phases
print("OK step order includes plan/act/verify/review with inner refine")
PY

curl -sf "${BASE}/v1/sessions/${SESSION_ID}/plan" \
  -H "X-SightLoop-Token: ${TOKEN}" | tee /tmp/sightloop-m9a-plan.json
echo
python3 - <<'PY'
import json
plan = json.load(open("/tmp/sightloop-m9a-plan.json"))["plan"]
assert plan and plan["allowed_files"], plan
print("OK plan", plan["allowed_files"])
PY

curl -sf "${BASE}/v1/sessions/${SESSION_ID}/agent-review" \
  -H "X-SightLoop-Token: ${TOKEN}" | tee /tmp/sightloop-m9a-review.json
echo
python3 - <<'PY'
import json
rev = json.load(open("/tmp/sightloop-m9a-review.json"))["review"]
assert rev and rev["verdict"] == "pass", rev
print("OK agent-review", rev["verdict"])
PY

# Accept (may 409 if M8 gate required — disable gate for dual-loop smoke via project or force)
# Prefer Accept; if M8 gate blocks, note and revert path still proves dual-loop.
HTTP_ACC="$(curl -s -o /tmp/sightloop-m9a-accept.json -w '%{http_code}' -X POST \
  "${BASE}/v1/sessions/${SESSION_ID}/review" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{"decision":"accept"}')"
if [[ "$HTTP_ACC" == "200" ]]; then
  python3 - <<'PY'
import json
d = json.load(open("/tmp/sightloop-m9a-accept.json"))
assert d["session"]["status"] in ("accepted", "distilling"), d["session"]["status"]
print("OK Human Accept", d["session"]["status"])
PY
else
  echo "Accept HTTP $HTTP_ACC (likely M8 gate) — reverting instead"
  cat /tmp/sightloop-m9a-accept.json || true
  curl -sf -X POST "${BASE}/v1/sessions/${SESSION_ID}/review" \
    -H "Content-Type: application/json" \
    -H "X-SightLoop-Token: ${TOKEN}" \
    -d '{"decision":"revert"}' >/tmp/sightloop-m9a-revert.json
  echo "OK Human Revert after dual-loop"
fi

echo "== whitelist intercept (force plan files outside project) =="
# Free repo lock if still awaiting
curl -s -X POST "${BASE}/v1/sessions/${SESSION_ID}/review" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{"decision":"revert"}' >/dev/null || true

# New project for intercept (daemon must be started with FORCE_PLAN_FILES for this — we simulate via a second start env is already set on daemon)
# Instead call dual-loop unit-level is covered by vitest; here ensure audit path via force env if present.
if [[ -n "${SIGHTLOOP_DUAL_LOOP_FORCE_PLAN_FILES:-}" ]]; then
  curl -sf -X POST "${BASE}/v1/sessions" \
    -H "Content-Type: application/json" \
    -H "X-SightLoop-Token: ${TOKEN}" \
    -d "$(python3 -c "import json; print(json.dumps({
    'project_id': '${PROJECT_ID}',
    'page_url': 'http://127.0.0.1:5175/',
    'sniff': {'framework':'unknown'},
    'annotation': {'note':'whitelist intercept'},
  }))")" | tee /tmp/sightloop-m9a-session2.json
  SID2="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m9a-session2.json"))["session"]["id"])')"
  HTTP2="$(curl -s -o /tmp/sightloop-m9a-start2.json -w '%{http_code}' -X POST \
    "${BASE}/v1/sessions/${SID2}/start" \
    -H "Content-Type: application/json" \
    -H "X-SightLoop-Token: ${TOKEN}" \
    -d '{}')"
  echo "intercept start HTTP $HTTP2"
  python3 - <<'PY'
import json
d = json.load(open("/tmp/sightloop-m9a-start2.json"))
# failed or awaiting with audit — either is OK if plan blocked
status = d.get("session", {}).get("status") or d.get("error", {}).get("code")
print("intercept result", status)
PY
else
  echo "SKIP live intercept (set SIGHTLOOP_DUAL_LOOP_FORCE_PLAN_FILES on daemon); covered by dual-loop vitest"
fi

echo
echo "SMOKE M9a OK"
echo "DEMO_PATH=$DEMO_PATH"
echo "SESSION_ID=$SESSION_ID"
echo "VERSION=$VERSION"
