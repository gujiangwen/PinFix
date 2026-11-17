#!/usr/bin/env bash
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
curl -sf "http://127.0.0.1:7420/health" | tee /tmp/sightloop-health.json
echo

echo "== create project =="
curl -sf -X POST "http://127.0.0.1:7420/v1/projects" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 - <<PY
import json
print(json.dumps({
  "name": "smoke-demo",
  "repo_path": "${DEMO_PATH}",
  "origin_pattern": "http://localhost:5173/*",
  "verify_cmd": "pnpm test",
  "file_whitelist": ["src/**"],
  "mode": "hmr",
}))
PY
)" | tee /tmp/sightloop-create.json
echo

echo "== list projects =="
curl -sf "http://127.0.0.1:7420/v1/projects" \
  -H "X-SightLoop-Token: ${TOKEN}"
echo
echo "OK"
