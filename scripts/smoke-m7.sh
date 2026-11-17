#!/usr/bin/env bash
# Smoke M7: locate waterfall + files search + source-correct → hints/knowledge
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
DEMO_PATH="${SIGHTLOOP_SMOKE_PATH:-/tmp/sightloop-m7-demo-$$-$(date +%s)}"

rm -rf "$DEMO_PATH"
mkdir -p "$DEMO_PATH/src/components"
echo "# m7" > "$DEMO_PATH/README.md"
cat > "$DEMO_PATH/src/components/ProductCard.tsx" <<'EOF'
export function ProductCard() {
  return <button data-testid="product">Buy</button>;
}
EOF
echo "export const ready = true;" > "$DEMO_PATH/src/app.ts"
# Fake source map for locate-from-local-maps path
mkdir -p "$DEMO_PATH/dist"
cat > "$DEMO_PATH/dist/app.js.map" <<'EOF'
{"version":3,"file":"app.js","sources":["webpack:///./src/components/ProductCard.tsx","webpack:///./src/app.ts"],"mappings":"AAAA"}
EOF
git -C "$DEMO_PATH" init -q
git -C "$DEMO_PATH" config user.email "sightloop@localhost"
git -C "$DEMO_PATH" config user.name "SightLoop"
git -C "$DEMO_PATH" add -A
git -C "$DEMO_PATH" commit -qm "chore: m7 smoke"

echo "== health =="
curl -sf "${BASE}/health" | tee /tmp/sightloop-m7-health.json
echo
VERSION="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m7-health.json")).get("version",""))')"
echo "VERSION=$VERSION"
[[ "$VERSION" == "0.7.0" ]] || echo "WARN: expected daemon version 0.7.0 (got $VERSION)"

echo "== project =="
curl -sf -X POST "${BASE}/v1/projects" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'name': 'm7-fixture',
  'repo_path': '${DEMO_PATH}',
  'origin_pattern': 'http://localhost:5175/*',
  'file_whitelist': ['src/**'],
  'mode': 'hmr',
  'dev_server_origin': 'http://127.0.0.1:5175',
}))")" | tee /tmp/sightloop-m7-project.json
echo
PROJECT_ID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m7-project.json"))["project"]["id"])')"

echo "== files?q=Product (whitelist) =="
curl -sf "${BASE}/v1/projects/${PROJECT_ID}/files?q=Product&limit=10" \
  -H "X-SightLoop-Token: ${TOKEN}" | tee /tmp/sightloop-m7-files.json
echo
python3 - <<'PY'
import json
files = json.load(open("/tmp/sightloop-m7-files.json"))["files"]
assert any("ProductCard" in f for f in files), files
assert all(f.startswith("src/") for f in files), files
print("OK files whitelist", files)
PY

echo "== files reject outside whitelist via correct path check =="
# create session first
curl -sf -X POST "${BASE}/v1/sessions" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'project_id': '${PROJECT_ID}',
  'page_url': 'http://localhost:5175/',
  'sniff': {
    'framework': 'unknown',
    'selector': '[data-testid=product]',
    'fingerprint': 'button[testid=product]',
    'location': {
      'file': 'src/unknown',
      'confidence': 0.12,
      'confidence_level': 'low',
      'method': 'unknown'
    }
  },
  'annotation': {'note': 'm7 smoke', 'selector': '[data-testid=product]'},
}))")" | tee /tmp/sightloop-m7-session.json
echo
SESSION_ID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m7-session.json"))["session"]["id"])')"

HTTP_CODE="$(curl -s -o /tmp/sightloop-m7-reject.json -w '%{http_code}' -X POST \
  "${BASE}/v1/sessions/${SESSION_ID}/source-correct" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{"file":"../etc/passwd","selector":"[data-testid=product]"}')"
[[ "$HTTP_CODE" == "400" ]] || { echo "FAIL expected 400 for path escape, got $HTTP_CODE"; cat /tmp/sightloop-m7-reject.json; exit 1; }
echo "OK path escape rejected ($HTTP_CODE)"

echo "== locate (source map / heuristic) =="
curl -sf -X POST "${BASE}/v1/projects/${PROJECT_ID}/locate" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{"selector":"[data-testid=other]","component_name":"ProductCard"}' \
  | tee /tmp/sightloop-m7-locate.json
echo
python3 - <<'PY'
import json
loc = json.load(open("/tmp/sightloop-m7-locate.json")).get("location") or {}
assert loc.get("file"), loc
assert loc.get("confidence_level") in ("high","medium","low"), loc
print("OK locate", loc.get("method"), loc.get("file"), loc.get("confidence_level"))
PY

echo "== source-correct (human) =="
curl -sf -X POST "${BASE}/v1/sessions/${SESSION_ID}/source-correct" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{"file":"src/components/ProductCard.tsx","line":2,"selector":"[data-testid=product]","fingerprint":"button[testid=product]","note":"m7 human correct"}' \
  | tee /tmp/sightloop-m7-correct.json
echo
python3 - <<'PY'
import json
d = json.load(open("/tmp/sightloop-m7-correct.json"))
assert d["location"]["method"] == "human"
assert d["location"]["confidence_level"] == "high"
assert d["hint"]["file_path"].endswith("ProductCard.tsx")
assert d["knowledge"]["kind"] == "selector_map"
print("OK correct", d["location"]["file"], d["hint"]["id"][:8])
PY

echo "== locate again → human / selector_memory =="
curl -sf -X POST "${BASE}/v1/projects/${PROJECT_ID}/locate" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{"selector":"[data-testid=product]","fingerprint":"button[testid=product]"}' \
  | tee /tmp/sightloop-m7-locate2.json
echo
python3 - <<'PY'
import json
loc = json.load(open("/tmp/sightloop-m7-locate2.json"))["location"]
assert loc["method"] in ("human", "selector_memory"), loc
assert loc["confidence_level"] == "high", loc
assert "ProductCard" in loc["file"], loc
print("OK memory hit", loc["method"], loc["confidence"])
PY

echo "== source-maps list =="
curl -sf "${BASE}/v1/projects/${PROJECT_ID}/source-maps" \
  -H "X-SightLoop-Token: ${TOKEN}" | tee /tmp/sightloop-m7-maps.json
echo
python3 - <<'PY'
import json
hints = json.load(open("/tmp/sightloop-m7-maps.json"))["hints"]
assert len(hints) >= 1
print("OK hints", len(hints))
PY

echo
echo "SMOKE M7 OK"
echo "DEMO_PATH=$DEMO_PATH"
echo "PROJECT_ID=$PROJECT_ID"
echo "SESSION_ID=$SESSION_ID"
echo "VERSION=$VERSION"
