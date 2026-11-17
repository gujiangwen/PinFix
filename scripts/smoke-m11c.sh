#!/usr/bin/env bash
# Smoke M11c: acceptance list API + retrieve hits; replay best-effort
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then set -a; # shellcheck disable=SC1091
  source .env; set +a; fi

TOKEN="${SIGHTLOOP_TOKEN:-dev-token-change-me}"
BASE="http://127.0.0.1:7420"
DEMO_PATH="/tmp/sightloop-m11c-demo-$$-$(date +%s)"

rm -rf "$DEMO_PATH" && mkdir -p "$DEMO_PATH/src" "$DEMO_PATH/acceptance/scenarios" "$DEMO_PATH/acceptance/baselines/fp-m11c"
echo "# m11c" > "$DEMO_PATH/README.md"
echo "export const x=1;" > "$DEMO_PATH/src/app.ts"
# minimal png
python3 - <<PY
from pathlib import Path
import struct,zlib
def png(w,h):
    def chunk(t,d):
        return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    raw=b''.join(b'\\x00'+bytes([0,0,0,0])*w for _ in range(h))
    return b'\\x89PNG\\r\\n\\x1a\\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')
Path("${DEMO_PATH}/acceptance/baselines/fp-m11c/hero.png").write_bytes(png(1,1))
PY
cat > "$DEMO_PATH/acceptance/scenarios/fp-m11c.json" <<'JSON'
{
  "version": 1,
  "fingerprint": "fp-m11c",
  "session_id": "seed",
  "project_id": "seed",
  "start_url": "http://127.0.0.1:5175/",
  "accepted_at": 1,
  "scenario": {
    "version": 1,
    "session_id": "seed",
    "start_url": "http://127.0.0.1:5175/",
    "viewport": {"width": 1280, "height": 720},
    "steps": [
      {"id": "goto", "action": "goto", "value": "http://127.0.0.1:5175/"},
      {"id": "shot", "action": "screenshot", "name": "hero"}
    ],
    "gates": {
      "console": {"fail_on_error": false, "fail_on_warning": false, "ignore_patterns": []},
      "network": {"fail_on_http_error": false, "ignore_url_patterns": []}
    }
  }
}
JSON
cat > "$DEMO_PATH/acceptance/manifest.json" <<'JSON'
{
  "version": 1,
  "updated_at": 1,
  "entries": [{
    "fingerprint": "fp-m11c",
    "session_id": "seed",
    "project_id": "seed",
    "scenario_rel": "scenarios/fp-m11c.json",
    "baselines_rel": "baselines/fp-m11c",
    "accepted_at": 1
  }]
}
JSON

git -C "$DEMO_PATH" init -q
git -C "$DEMO_PATH" config user.email "sightloop@localhost"
git -C "$DEMO_PATH" config user.name "SightLoop"
git -C "$DEMO_PATH" add -A && git -C "$DEMO_PATH" commit -qm "m11c"

curl -sf -X POST "${BASE}/v1/projects" -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'name':'m11c','repo_path':'${DEMO_PATH}','origin_pattern':'http://127.0.0.1:5175/*',
  'file_whitelist':['src/**'],'mode':'hmr',
  'acceptance_gate':{'enabled':False,'require_pass_to_accept':False},
}))")" >/tmp/m11c-proj.json
PROJECT_ID="$(python3 -c 'import json;print(json.load(open("/tmp/m11c-proj.json"))["project"]["id"])')"

curl -sf "${BASE}/v1/projects/${PROJECT_ID}/acceptance" \
  -H "X-SightLoop-Token: ${TOKEN}" | tee /tmp/m11c-list.json
echo
python3 - <<'PY'
import json
d=json.load(open("/tmp/m11c-list.json"))
assert any(e.get("fingerprint")=="fp-m11c" for e in d.get("entries",[])), d
print("OK list acceptance", len(d["entries"]))
PY

# retrieve unit via tsx
pnpm --filter @sightloop/dual-loop exec tsx -e "
import { retrieveAcceptanceHits } from './src/acceptance-retrieve.ts';
const hits = retrieveAcceptanceHits('${DEMO_PATH}', { note: 'fp-m11c', selector: 'hero' }, 3);
console.log(JSON.stringify(hits));
if (!hits.length) process.exit(1);
"

# replay — best effort (may need chromium / live origin)
HTTP_REPLAY="$(curl -s -o /tmp/m11c-replay.json -w '%{http_code}' -X POST \
  "${BASE}/v1/projects/${PROJECT_ID}/acceptance/replay" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{"fingerprints":["fp-m11c"]}')"
echo "replay HTTP $HTTP_REPLAY"
cat /tmp/m11c-replay.json || true
echo
python3 - <<'PY'
import json
d=json.load(open("/tmp/m11c-replay.json"))
assert "results" in d, d
print("OK replay response", d["results"])
# pass/fail both acceptable for smoke when fixture origin may be down
PY

echo "SMOKE M11c OK PROJECT=$PROJECT_ID"
