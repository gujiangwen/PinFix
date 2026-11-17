#!/usr/bin/env bash
# CI helper: POST /v1/projects/:id/acceptance/replay
set -euo pipefail
PROJECT_ID="${1:?project id required}"
TOKEN="${SIGHTLOOP_TOKEN:-dev-token-change-me}"
BASE="${SIGHTLOOP_DAEMON_URL:-http://127.0.0.1:7420}"
curl -sf -X POST "${BASE}/v1/projects/${PROJECT_ID}/acceptance/replay" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{"all":true}'
echo
