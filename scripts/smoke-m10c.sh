#!/usr/bin/env bash
# Smoke M10c: Accept archives Scenario IR + baselines under <repo>/acceptance/
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
DEMO_PATH="${SIGHTLOOP_SMOKE_PATH:-/tmp/sightloop-m10c-demo-$$-$(date +%s)}"

rm -rf "$DEMO_PATH"
mkdir -p "$DEMO_PATH/src"
echo "# m10c" > "$DEMO_PATH/README.md"
echo "export const ready = true;" > "$DEMO_PATH/src/app.ts"
git -C "$DEMO_PATH" init -q
git -C "$DEMO_PATH" config user.email "sightloop@localhost"
git -C "$DEMO_PATH" config user.name "SightLoop"
git -C "$DEMO_PATH" add -A
git -C "$DEMO_PATH" commit -qm "chore: m10c smoke"

# Seed daemon gate baselines + exercise archive helper via tsx
GATE_ROOT="${ROOT}/data/acceptance-gates"
FP="m10csmoke${RANDOM}"
PROJ_FAKE="projm10c"
mkdir -p "${GATE_ROOT}/baselines/${PROJ_FAKE}/${FP}"
# minimal 1x1 png
python3 - <<PY
from pathlib import Path
# PNG header for 1x1 transparent
import struct,zlib
def png(w,h,rgba=(0,0,0,0)):
    def chunk(t,d):
        return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    raw=b''.join(b'\\x00'+bytes(rgba)*w for _ in range(h))
    return b'\\x89PNG\\r\\n\\x1a\\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')
Path("${GATE_ROOT}/baselines/${PROJ_FAKE}/${FP}/hero.png").write_bytes(png(1,1))
print("seeded baseline")
PY

pnpm --filter @sightloop/daemon exec tsx -e "
import { archiveAcceptanceToRepo } from './src/acceptance-archive.ts';
const r = archiveAcceptanceToRepo({
  repoPath: '${DEMO_PATH}',
  projectId: '${PROJ_FAKE}',
  sessionId: 'sess-m10c',
  fingerprint: '${FP}',
  scenario: { version: 1, start_url: 'http://127.0.0.1:5175/', steps: [], gates: {}, viewport: { width: 1280, height: 720 } },
  startUrl: 'http://127.0.0.1:5175/',
  baselinesRoot: '${GATE_ROOT}/baselines',
});
console.log(JSON.stringify(r));
if (!r.ok) process.exit(1);
"

python3 - <<PY
from pathlib import Path
root = Path("${DEMO_PATH}/acceptance")
assert (root / "scenarios" / "${FP}.json").is_file(), root
assert (root / "baselines" / "${FP}" / "hero.png").is_file()
assert (root / "manifest.json").is_file()
assert (root / "README.md").is_file()
import json
sc = json.loads((root / "scenarios" / "${FP}.json").read_text())
assert sc["fingerprint"] == "${FP}"
assert sc["scenario"]["start_url"].startswith("http")
print("OK archive files", root)
PY

# Also verify Accept response exposes acceptance_archive (skip path when no gate)
curl -sf -X POST "${BASE}/v1/projects" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'name': 'm10c-fixture',
  'repo_path': '${DEMO_PATH}',
  'origin_pattern': 'http://127.0.0.1:5176/*',
  'file_whitelist': ['src/**'],
  'mode': 'hmr',
  'acceptance_gate': {'enabled': False, 'require_pass_to_accept': False},
}))")" >/tmp/sightloop-m10c-project.json
PROJECT_ID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m10c-project.json"))["project"]["id"])')"

curl -sf -X POST "${BASE}/v1/sessions" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'project_id': '${PROJECT_ID}',
  'page_url': 'http://127.0.0.1:5176/',
  'sniff': {'framework':'unknown'},
  'annotation': {'note':'m10c'},
}))")" >/tmp/sightloop-m10c-session.json
SESSION_ID="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m10c-session.json"))["session"]["id"])')"

# Force awaiting_review via start (single-loop mock) then accept
curl -sf -X POST "${BASE}/v1/sessions/${SESSION_ID}/start" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{}' >/tmp/sightloop-m10c-start.json
python3 - <<'PY'
import json
s=json.load(open("/tmp/sightloop-m10c-start.json"))["session"]
assert s["status"]=="awaiting_review", s
print("OK start", s["status"])
PY

curl -sf -X POST "${BASE}/v1/sessions/${SESSION_ID}/review" \
  -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{"decision":"accept"}' | tee /tmp/sightloop-m10c-accept.json
echo
python3 - <<'PY'
import json
d=json.load(open("/tmp/sightloop-m10c-accept.json"))
assert d["session"]["status"] in ("accepted","distilling"), d["session"]["status"]
arch=d.get("acceptance_archive")
assert arch is not None, d
assert arch.get("detail") in ("no_gate_run",) or arch.get("ok") in (True, False)
print("OK accept acceptance_archive", arch)
PY

echo
echo "SMOKE M10c OK"
echo "DEMO_PATH=$DEMO_PATH"
