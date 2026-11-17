#!/usr/bin/env bash
# Smoke M3: markup write → start loop (mock) → awaiting_review → diff → accept|refine|revert
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
DECISION="${SIGHTLOOP_SMOKE_DECISION:-accept}"  # accept | refine | revert
# Unique path per run so a leftover awaiting_review session cannot block repo_path.
DEMO_PATH="${SIGHTLOOP_SMOKE_PATH:-/tmp/sightloop-m3-demo-$$-${DECISION}-$(date +%s)}"

rm -rf "$DEMO_PATH"
mkdir -p "$DEMO_PATH/src"
echo "# demo" > "$DEMO_PATH/README.md"
echo "export const ready = true;" > "$DEMO_PATH/src/app.ts"
git -C "$DEMO_PATH" init -q
git -C "$DEMO_PATH" config user.email "sightloop@localhost"
git -C "$DEMO_PATH" config user.name "SightLoop"
git -C "$DEMO_PATH" add -A
git -C "$DEMO_PATH" commit -qm "chore: smoke fixture"

echo "== health =="
curl -sf "http://127.0.0.1:7420/health" | tee /tmp/sightloop-m3-health.json
echo

echo "== ensure project =="
HTTP_CODE="$(curl -s -o /tmp/sightloop-m3-project.json -w '%{http_code}' -X POST "http://127.0.0.1:7420/v1/projects" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'name': 'm3-fixture',
  'repo_path': '${DEMO_PATH}',
  'origin_pattern': 'http://localhost:5175/*',
  'verify_cmd': None,
  'file_whitelist': ['src/**'],
  'mode': 'hmr',
}))")")"

if [[ "$HTTP_CODE" == "201" ]]; then
  cat /tmp/sightloop-m3-project.json
  echo
  PROJECT_ID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m3-project.json"))["project"]["id"])')"
else
  echo "(create returned $HTTP_CODE — listing projects and picking matching repo)"
  curl -sf "http://127.0.0.1:7420/v1/projects" \
    -H "X-SightLoop-Token: ${TOKEN}" | tee /tmp/sightloop-m3-projects.json
  echo
  PROJECT_ID="$(python3 -c "import json; ps=json.load(open('/tmp/sightloop-m3-projects.json'))['projects'];
print(next((p['id'] for p in ps if p['repo_path']=='${DEMO_PATH}'), ps[0]['id']))")"
fi
echo "PROJECT_ID=$PROJECT_ID"

echo "== create session (writes markup workspace) =="
curl -sf -X POST "http://127.0.0.1:7420/v1/sessions" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'project_id': '${PROJECT_ID}',
  'page_url': 'http://localhost:5175/',
  'sniff': {
    'framework': 'react',
    'componentStack': [{'name': 'ProductCard'}],
    'selector': '[data-testid=\"product-Aurora Lamp\"]',
  },
  'annotation': {
    'note': 'm3 smoke — make CTA clearer',
    'selector': '[data-testid=\"product-Aurora Lamp\"]',
  },
}))")" | tee /tmp/sightloop-m3-session.json
echo

SESSION_ID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m3-session.json"))["session"]["id"])')"
ANNOTATION_REF="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m3-session.json"))["session"].get("annotation_ref") or "")')"
echo "SESSION_ID=$SESSION_ID"
echo "ANNOTATION_REF=$ANNOTATION_REF"
if [[ -z "$ANNOTATION_REF" ]]; then
  echo "FAIL: expected annotation_ref after markup write"
  exit 1
fi

echo "== start loop =="
curl -sf -X POST "http://127.0.0.1:7420/v1/sessions/${SESSION_ID}/start" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{}' | tee /tmp/sightloop-m3-start.json
echo

STATUS="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m3-start.json"))["session"]["status"])')"
echo "STATUS_AFTER_START=$STATUS"
if [[ "$STATUS" != "awaiting_review" ]]; then
  echo "FAIL: expected awaiting_review, got $STATUS"
  curl -sf "http://127.0.0.1:7420/v1/sessions/${SESSION_ID}" \
    -H "X-SightLoop-Token: ${TOKEN}" || true
  exit 1
fi

echo "== diff =="
curl -sf "http://127.0.0.1:7420/v1/sessions/${SESSION_ID}/diff" \
  -H "X-SightLoop-Token: ${TOKEN}" | tee /tmp/sightloop-m3-diff.json
echo
PATCH_LEN="$(python3 -c 'import json; print(len(json.load(open("/tmp/sightloop-m3-diff.json")).get("patch") or ""))')"
echo "PATCH_LEN=$PATCH_LEN"
if [[ "$PATCH_LEN" -lt 1 ]]; then
  echo "FAIL: expected non-empty patch from mock runner"
  exit 1
fi

echo "== review (${DECISION}) =="
curl -sf -X POST "http://127.0.0.1:7420/v1/sessions/${SESSION_ID}/review" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'decision': '${DECISION}',
  'note': 'smoke ${DECISION}',
}))")" | tee /tmp/sightloop-m3-review.json
echo

FINAL="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m3-review.json"))["session"]["status"])')"
echo "FINAL_STATUS=$FINAL"

if [[ "$DECISION" == "accept" && "$FINAL" != "accepted" ]]; then
  echo "FAIL: accept should end accepted"
  exit 1
fi
if [[ "$DECISION" == "revert" && "$FINAL" != "reverted" ]]; then
  echo "FAIL: revert should end reverted"
  exit 1
fi
if [[ "$DECISION" == "refine" ]]; then
  # refine kicks another loop; wait briefly then poll
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 0.5
    curl -sf "http://127.0.0.1:7420/v1/sessions/${SESSION_ID}" \
      -H "X-SightLoop-Token: ${TOKEN}" > /tmp/sightloop-m3-poll.json
    FINAL="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m3-poll.json"))["session"]["status"])')"
    echo "poll=$FINAL"
    if [[ "$FINAL" == "awaiting_review" || "$FINAL" == "failed" ]]; then
      break
    fi
  done
  if [[ "$FINAL" != "awaiting_review" ]]; then
    echo "FAIL: refine should return to awaiting_review (got $FINAL)"
    exit 1
  fi
fi

if [[ "$DECISION" == "accept" ]]; then
  echo "== knowledge =="
  curl -sf "http://127.0.0.1:7420/v1/knowledge?project_id=${PROJECT_ID}" \
    -H "X-SightLoop-Token: ${TOKEN}" | tee /tmp/sightloop-m3-knowledge.json
  echo
  KCOUNT="$(python3 -c 'import json; print(len(json.load(open("/tmp/sightloop-m3-knowledge.json")).get("knowledge") or []))')"
  if [[ "$KCOUNT" -lt 1 ]]; then
    echo "FAIL: Distill-on-Accept should insert knowledge"
    exit 1
  fi
fi

echo "OK — M3 smoke passed (decision=$DECISION)"
