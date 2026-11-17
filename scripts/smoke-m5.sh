#!/usr/bin/env bash
# Smoke M5: DX status + bootstrap gate + ensure-fixture + runner mode
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

echo "== health =="
curl -sf "${BASE}/health" | tee /tmp/sightloop-m5-health.json
echo
VERSION="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m5-health.json")).get("version",""))')"
echo "VERSION=$VERSION"

echo "== dx/status (loopback, no token) =="
curl -sf "${BASE}/v1/dx/status" | tee /tmp/sightloop-m5-dx-status.json
echo
python3 - <<'PY'
import json
s=json.load(open("/tmp/sightloop-m5-dx-status.json"))
assert s["daemon"]["ok"] is True
assert s["auth"]["token_required"] is True
assert s["auth"]["token_configured"] is True
assert s["runner"]["mode"] in ("mock","pi")
assert "llm_key_present" in s["runner"]
# never leak full secrets
blob=json.dumps(s)
assert "OPENAI" not in blob
assert "sk-" not in blob
print("runner", s["runner"])
print("OK dx/status")
PY

echo "== bootstrap disabled by default =="
HTTP_CODE="$(curl -s -o /tmp/sightloop-m5-bootstrap.json -w '%{http_code}' -X POST "${BASE}/v1/dx/bootstrap" -H 'Content-Type: application/json' -d '{}')"
echo "bootstrap_http=$HTTP_CODE"
if [[ "${SIGHTLOOP_DX_BOOTSTRAP:-0}" == "1" || "${SIGHTLOOP_DX_BOOTSTRAP:-}" == "true" ]]; then
  [[ "$HTTP_CODE" == "200" ]] || { echo "FAIL: bootstrap should work when enabled"; exit 1; }
  python3 - <<'PY'
import json
b=json.load(open("/tmp/sightloop-m5-bootstrap.json"))
assert b.get("ok") is True
assert b.get("token")
assert b.get("token_preview")
print("OK bootstrap enabled path")
PY
else
  [[ "$HTTP_CODE" == "403" || "$HTTP_CODE" == "404" ]] || {
    echo "FAIL: bootstrap should be 403/404 when SIGHTLOOP_DX_BOOTSTRAP=0 (got $HTTP_CODE)"
    cat /tmp/sightloop-m5-bootstrap.json
    exit 1
  }
  echo "OK bootstrap disabled"
fi

echo "== ensure-fixture-project =="
curl -sf -X POST "${BASE}/v1/dx/ensure-fixture-project" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{}' | tee /tmp/sightloop-m5-ensure.json
echo
python3 - <<'PY'
import json
e=json.load(open("/tmp/sightloop-m5-ensure.json"))
assert e["project_id"]
assert e["project"]["origin_pattern"]=="http://localhost:5175/*"
assert e["project"]["repo_path"]
print("project_id", e["project_id"], "created", e.get("created"), "path", e["project"]["repo_path"])
print("OK ensure-fixture")
PY

echo "== ensure idempotent =="
curl -sf -X POST "${BASE}/v1/dx/ensure-fixture-project" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{}' | tee /tmp/sightloop-m5-ensure2.json
echo
python3 - <<'PY'
import json
a=json.load(open("/tmp/sightloop-m5-ensure.json"))
b=json.load(open("/tmp/sightloop-m5-ensure2.json"))
assert a["project_id"]==b["project_id"]
assert b.get("created") is False
print("OK idempotent")
PY

echo "== dx/status shows fixture_project_id =="
curl -sf "${BASE}/v1/dx/status" | tee /tmp/sightloop-m5-dx-status2.json
echo
python3 - <<'PY'
import json
s=json.load(open("/tmp/sightloop-m5-dx-status2.json"))
fid=json.load(open("/tmp/sightloop-m5-ensure.json"))["project_id"]
assert s["projects"]["fixture_project_id"]==fid
assert s["projects"]["count"]>=1
print("OK fixture linked in dx/status")
PY

echo "== bind bad repo_path is readable =="
HTTP_CODE="$(curl -s -o /tmp/sightloop-m5-badbind.json -w '%{http_code}' -X POST "${BASE}/v1/projects" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{"name":"bad","repo_path":"/definitely/not/allowed/sightloop","origin_pattern":"http://localhost/*","file_whitelist":["src/**"],"mode":"hmr"}')"
echo "badbind_http=$HTTP_CODE"
python3 - <<'PY'
import json
b=json.load(open("/tmp/sightloop-m5-badbind.json"))
err=b.get("error") or {}
assert err.get("code") in ("path_escape_blocked","path_missing","path_not_absolute"), err
assert err.get("message")
print("OK readable bind failure", err.get("code"))
PY

echo "OK — M5 smoke passed"
echo "Popup: Load unpacked apps/extension/dist → open Popup → 一键准备 Demo"
echo "Runner badge comes from /v1/dx/status (mock without LLM key)."
