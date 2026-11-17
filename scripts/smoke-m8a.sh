#!/usr/bin/env bash
# Smoke M8a: Playwright fixture gate — fail→409 Accept, pass→Accept 200
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
DEMO_PATH="${SIGHTLOOP_SMOKE_PATH:-/tmp/sightloop-m8a-demo-$$-$(date +%s)}"
FIXTURE_DIR="${DEMO_PATH}/fixture-site"
FIXTURE_PORT=5175

rm -rf "$DEMO_PATH"
mkdir -p "$DEMO_PATH/src" "$FIXTURE_DIR"
echo "# m8a" > "$DEMO_PATH/README.md"
echo "export const ready = true;" > "$DEMO_PATH/src/app.ts"

cat > "$FIXTURE_DIR/good.html" <<'EOF'
<!doctype html>
<html><head><title>m8a good</title></head>
<body>
  <h1>Good fixture</h1>
  <button data-testid="gate-ok">Ready</button>
</body></html>
EOF

cat > "$FIXTURE_DIR/bad.html" <<'EOF'
<!doctype html>
<html><head><title>m8a bad</title></head>
<body>
  <h1>Bad fixture</h1>
  <p>Missing gate-ok control</p>
  <script>console.error("m8a intentional console error");</script>
</body></html>
EOF

git -C "$DEMO_PATH" init -q
git -C "$DEMO_PATH" config user.email "sightloop@localhost"
git -C "$DEMO_PATH" config user.name "SightLoop"
git -C "$DEMO_PATH" add -A
git -C "$DEMO_PATH" commit -qm "chore: m8a smoke"

# Kill anything on fixture port, then serve static site
fuser -k "${FIXTURE_PORT}/tcp" 2>/dev/null || true
sleep 0.5
python3 -m http.server "$FIXTURE_PORT" --bind 127.0.0.1 --directory "$FIXTURE_DIR" >/tmp/sightloop-m8a-fixture.log 2>&1 &
FIXTURE_PID=$!
cleanup() {
  kill "$FIXTURE_PID" 2>/dev/null || true
}
trap cleanup EXIT
sleep 0.8
curl -sf "http://127.0.0.1:${FIXTURE_PORT}/good.html" >/dev/null

echo "== health =="
curl -sf "${BASE}/health" | tee /tmp/sightloop-m8a-health.json
echo
VERSION="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m8a-health.json")).get("version",""))')"
echo "VERSION=$VERSION"
[[ "$VERSION" == "0.8.0" ]] || echo "WARN: expected daemon 0.8.0 (got $VERSION)"

# Ensure playwright chromium is available
if ! pnpm --filter @sightloop/acceptance-gate exec playwright --version >/dev/null 2>&1; then
  echo "FAIL: playwright CLI missing — run: pnpm --filter @sightloop/acceptance-gate exec playwright install chromium"
  exit 1
fi

echo "== project =="
curl -sf -X POST "${BASE}/v1/projects" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'name': 'm8a-fixture',
  'repo_path': '${DEMO_PATH}',
  'origin_pattern': 'http://127.0.0.1:5175/*',
  'file_whitelist': ['src/**'],
  'mode': 'hmr',
  'dev_server_origin': 'http://127.0.0.1:5175',
}))")" | tee /tmp/sightloop-m8a-project.json
echo
PROJECT_ID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m8a-project.json"))["project"]["id"])')"

make_session() {
  local PAGE="$1"
  local LABEL="$2"
  curl -sf -X POST "${BASE}/v1/sessions" \
    -H "Content-Type: application/json" \
    -H "X-SightLoop-Token: ${TOKEN}" \
    -d "$(python3 -c "import json; print(json.dumps({
    'project_id': '${PROJECT_ID}',
    'page_url': '${PAGE}',
    'sniff': {'framework':'unknown','selector':'[data-testid=gate-ok]'},
    'annotation': {
      'note': '${LABEL}',
      'selector': '[data-testid=gate-ok]',
      'expects': [{'type':'visible','selector':'[data-testid=gate-ok]'}],
    },
  }))")"
}

echo "== BAD session (missing selector) =="
make_session "http://127.0.0.1:${FIXTURE_PORT}/bad.html" "m8a bad" \
  | tee /tmp/sightloop-m8a-session-bad.json
echo
BAD_ID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m8a-session-bad.json"))["session"]["id"])')"

curl -sf -X POST "${BASE}/v1/sessions/${BAD_ID}/start" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{}' | tee /tmp/sightloop-m8a-start-bad.json
echo

wait_gate() {
  local SID="$1"
  local OUT="$2"
  local i=0
  while [[ $i -lt 60 ]]; do
    curl -sf "${BASE}/v1/sessions/${SID}/acceptance-gate" \
      -H "X-SightLoop-Token: ${TOKEN}" >"$OUT" || true
    local st
    st="$(python3 -c "import json; r=json.load(open('$OUT')).get('run') or {}; print(r.get('status') or '')" 2>/dev/null || true)"
    if [[ "$st" == "passed" || "$st" == "failed" || "$st" == "error" || "$st" == "cancelled" ]]; then
      echo "gate status=$st"
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  echo "FAIL: timed out waiting for acceptance gate"
  cat "$OUT" || true
  return 1
}

# Auto-run on awaiting_review — poll until finished
wait_gate "$BAD_ID" /tmp/sightloop-m8a-gate-bad.json
python3 - <<'PY'
import json
run = json.load(open("/tmp/sightloop-m8a-gate-bad.json"))["run"]
assert run["status"] in ("failed", "error"), run
print("OK bad gate status", run["status"], run.get("report", {}).get("failed_checks"))
PY

HTTP_CODE="$(curl -s -o /tmp/sightloop-m8a-accept-bad.json -w '%{http_code}' -X POST \
  "${BASE}/v1/sessions/${BAD_ID}/review" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{"decision":"accept"}')"
[[ "$HTTP_CODE" == "409" ]] || { echo "FAIL expected 409, got $HTTP_CODE"; cat /tmp/sightloop-m8a-accept-bad.json; exit 1; }
python3 - <<'PY'
import json
err = json.load(open("/tmp/sightloop-m8a-accept-bad.json"))["error"]
assert err["code"] == "acceptance_gate_failed", err
print("OK Accept blocked", err["code"])
PY

# Free repo lock (awaiting_review counts as active)
curl -sf -X POST "${BASE}/v1/sessions/${BAD_ID}/review" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{"decision":"revert"}' >/tmp/sightloop-m8a-revert-bad.json
echo "reverted bad session"

echo "== GOOD session =="
make_session "http://127.0.0.1:${FIXTURE_PORT}/good.html" "m8a good" \
  | tee /tmp/sightloop-m8a-session-good.json
echo
GOOD_ID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m8a-session-good.json"))["session"]["id"])')"

curl -sf -X POST "${BASE}/v1/sessions/${GOOD_ID}/start" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{}' >/tmp/sightloop-m8a-start-good.json
echo

wait_gate "$GOOD_ID" /tmp/sightloop-m8a-gate-good1.json
# Second manual run (baseline already created on first pass)
curl -sf -X POST "${BASE}/v1/sessions/${GOOD_ID}/acceptance-gate/run" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{"reason":"manual"}' | tee /tmp/sightloop-m8a-gate-good2.json
echo
python3 - <<'PY'
import json
run = json.load(open("/tmp/sightloop-m8a-gate-good2.json"))["run"]
assert run["status"] == "passed", run
print("OK good gate passed", run["id"][:8])
PY

# Artifact fetch
RUN_ID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m8a-gate-good2.json"))["run"]["id"])')"
curl -sf "${BASE}/v1/sessions/${GOOD_ID}/acceptance-gate/runs/${RUN_ID}/artifacts/report.json" \
  -H "X-SightLoop-Token: ${TOKEN}" | tee /tmp/sightloop-m8a-artifact.json >/dev/null
python3 - <<'PY'
import json
r = json.load(open("/tmp/sightloop-m8a-artifact.json"))
assert r.get("status") == "passed", r
print("OK artifact report.json")
PY

curl -sf -X POST "${BASE}/v1/sessions/${GOOD_ID}/review" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{"decision":"accept"}' | tee /tmp/sightloop-m8a-accept-good.json
echo
python3 - <<'PY'
import json
d = json.load(open("/tmp/sightloop-m8a-accept-good.json"))
assert d["session"]["status"] in ("accepted", "distilling"), d["session"]["status"]
print("OK Accept after pass →", d["session"]["status"])
PY

echo "== reject non-fixture URL =="
curl -sf -X POST "${BASE}/v1/sessions" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'project_id': '${PROJECT_ID}',
  'page_url': 'https://example.com/',
  'sniff': {'framework':'unknown'},
  'annotation': {'expects': [{'type':'visible','selector':'body'}]},
}))")" | tee /tmp/sightloop-m8a-session-remote.json
echo
REMOTE_ID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m8a-session-remote.json"))["session"]["id"])')"
# put in awaiting_review via start may fail compile on auto-run; force idle→manual run after fake status
# Start may still work for mock loop; gate run should 409
curl -sf -X POST "${BASE}/v1/sessions/${REMOTE_ID}/start" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{}' >/tmp/sightloop-m8a-start-remote.json || true
HTTP_REMOTE="$(curl -s -o /tmp/sightloop-m8a-gate-remote.json -w '%{http_code}' -X POST \
  "${BASE}/v1/sessions/${REMOTE_ID}/acceptance-gate/run" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{"reason":"manual"}')"
[[ "$HTTP_REMOTE" == "409" ]] || { echo "FAIL expected 409 for remote URL, got $HTTP_REMOTE"; cat /tmp/sightloop-m8a-gate-remote.json; exit 1; }
echo "OK non-fixture URL rejected ($HTTP_REMOTE)"

echo
echo "SMOKE M8a OK"
echo "DEMO_PATH=$DEMO_PATH"
echo "PROJECT_ID=$PROJECT_ID"
echo "VERSION=$VERSION"
