#!/usr/bin/env bash
# Smoke M2: health → project → session → WS subscribe status
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
DEMO_PATH="${SIGHTLOOP_SMOKE_PATH:-/tmp/sightloop-demo}"
mkdir -p "$DEMO_PATH"

echo "== health =="
curl -sf "http://127.0.0.1:7420/health" | tee /tmp/sightloop-m2-health.json
echo

echo "== ensure project =="
HTTP_CODE="$(curl -s -o /tmp/sightloop-m2-project.json -w '%{http_code}' -X POST "http://127.0.0.1:7420/v1/projects" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'name': 'm2-fixture',
  'repo_path': '${DEMO_PATH}',
  'origin_pattern': 'http://localhost:5175/*',
  'verify_cmd': None,
  'file_whitelist': ['src/**'],
  'mode': 'hmr',
}))")")"

if [[ "$HTTP_CODE" == "201" ]]; then
  cat /tmp/sightloop-m2-project.json
  echo
  PROJECT_ID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m2-project.json"))["project"]["id"])')"
else
  echo "(create returned $HTTP_CODE — listing existing projects)"
  curl -sf "http://127.0.0.1:7420/v1/projects" \
    -H "X-SightLoop-Token: ${TOKEN}" | tee /tmp/sightloop-m2-projects.json
  echo
  PROJECT_ID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m2-projects.json"))["projects"][0]["id"])')"
fi
echo "PROJECT_ID=$PROJECT_ID"

echo "== create session =="
curl -sf -X POST "http://127.0.0.1:7420/v1/sessions" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'project_id': '${PROJECT_ID}',
  'page_url': 'http://localhost:5175/',
  'sniff': {
    'framework': 'react',
    'componentStack': [{'name': 'ProductCard', 'props': {'title': 'Aurora Lamp'}}],
    'selector': '[data-testid=\"product-Aurora Lamp\"]',
    'domPath': 'div / article',
  },
  'annotation': {'note': 'm2 smoke', 'selector': '[data-testid=\"product-Aurora Lamp\"]'},
}))")" | tee /tmp/sightloop-m2-session.json
echo

SESSION_ID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m2-session.json"))["session"]["id"])')"
echo "SESSION_ID=$SESSION_ID"
export SIGHTLOOP_SMOKE_SESSION_ID="$SESSION_ID"
export SIGHTLOOP_TOKEN="$TOKEN"

echo "== get session =="
curl -sf "http://127.0.0.1:7420/v1/sessions/${SESSION_ID}" \
  -H "X-SightLoop-Token: ${TOKEN}" | tee /tmp/sightloop-m2-get.json
echo

echo "== websocket subscribe =="
export SIGHTLOOP_SMOKE_WS_REQUIRE_FROM="${ROOT}/apps/daemon/package.json"
node --input-type=module <<'NODE'
import { createRequire } from "node:module";
const require = createRequire(process.env.SIGHTLOOP_SMOKE_WS_REQUIRE_FROM);
const WebSocket = require("ws");

const token = process.env.SIGHTLOOP_TOKEN || "dev-token-change-me";
const sessionId = process.env.SIGHTLOOP_SMOKE_SESSION_ID;
if (!sessionId) {
  console.error("missing SIGHTLOOP_SMOKE_SESSION_ID");
  process.exit(1);
}

const url = `ws://127.0.0.1:7420/v1/ws?token=${encodeURIComponent(token)}`;
const ws = new WebSocket(url);
let ok = false;

const timer = setTimeout(() => {
  console.error("WS subscribe timed out");
  ws.close();
  process.exit(1);
}, 5000);

ws.on("open", () => {
  ws.send(JSON.stringify({ op: "subscribe", session_id: sessionId }));
});

ws.on("message", (raw) => {
  const data = JSON.parse(String(raw));
  console.log("WS<<", data);
  if (data.type === "session.status" && data.session_id === sessionId) {
    ok = true;
    clearTimeout(timer);
    ws.close();
  }
});

ws.on("close", () => {
  if (!ok) process.exit(1);
  console.log("WS OK");
  process.exit(0);
});

ws.on("error", (err) => {
  console.error(err);
  process.exit(1);
});
NODE

echo "OK — M2 smoke passed"
