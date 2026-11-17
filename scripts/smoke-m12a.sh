#!/usr/bin/env bash
# Smoke M12a + R1: Accept-only strategy distill; retrieve Top-K + min score
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then set -a; # shellcheck disable=SC1091
  source .env; set +a; fi

TOKEN="${SIGHTLOOP_TOKEN:-dev-token-change-me}"
BASE="http://127.0.0.1:7420"
DEMO_PATH="/tmp/sightloop-m12a-demo-$$-$(date +%s)"

python3 - <<'PY'
import os
assert os.environ.get("SIGHTLOOP_DUAL_LOOP") in ("1","true")
print("OK dual_loop")
PY

rm -rf "$DEMO_PATH" && mkdir -p "$DEMO_PATH/src"
echo "# m12a" > "$DEMO_PATH/README.md"
echo "export const x=1;" > "$DEMO_PATH/src/app.ts"
git -C "$DEMO_PATH" init -q
git -C "$DEMO_PATH" config user.email "sightloop@localhost"
git -C "$DEMO_PATH" config user.name "SightLoop"
git -C "$DEMO_PATH" add -A && git -C "$DEMO_PATH" commit -qm "m12a"

curl -sf -X POST "${BASE}/v1/projects" -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'name':'m12a','repo_path':'${DEMO_PATH}','origin_pattern':'http://127.0.0.1:5175/*',
  'file_whitelist':['src/**'],'mode':'hmr','verify_cmd':'true',
  'acceptance_gate':{'enabled':False,'require_pass_to_accept':False},
}))")" >/tmp/m12a-proj.json
PROJECT_ID="$(python3 -c 'import json;print(json.load(open("/tmp/m12a-proj.json"))["project"]["id"])')"

# Seed a low-score strategy card that should NOT inject (R1 min score)
curl -sf -X POST "${BASE}/v1/knowledge" -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'project_id':'${PROJECT_ID}',
  'kind':'pattern',
  'title':'Strategy · noise-only',
  'body_md':'<!-- sightloop:strategy pattern_id=noise -->\\nzzz unrelated',
  'tags':['strategy','noise'],
}))")" >/tmp/m12a-noise.json || true

curl -sf -X POST "${BASE}/v1/sessions" -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'project_id':'${PROJECT_ID}','page_url':'http://127.0.0.1:5175/',
  'sniff':{'framework':'unknown','selector':'[data-testid=gate-ok]'},
  'annotation':{'note':'gate-ok login form','selector':'[data-testid=gate-ok]'},
}))")" >/tmp/m12a-sess.json
SESSION_ID="$(python3 -c 'import json;print(json.load(open("/tmp/m12a-sess.json"))["session"]["id"])')"

curl -sf -X POST "${BASE}/v1/sessions/${SESSION_ID}/start" \
  -H "Content-Type: application/json" -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{}' >/tmp/m12a-start.json

# Accept → strategy distill (R1 Accept-only)
curl -sf -X POST "${BASE}/v1/sessions/${SESSION_ID}/review" \
  -H "Content-Type: application/json" -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{"decision":"accept"}' >/tmp/m12a-accept.json

python3 - <<'PY'
import json
acc=json.load(open("/tmp/m12a-accept.json"))
assert acc["session"]["status"]=="accepted", acc["session"]["status"]
sc=acc.get("strategy_card")
assert sc and sc.get("pattern_id"), acc
print("OK Accept distilled strategy", sc["pattern_id"])
# R9: agent_judge_pass is not Accept
assert "accept" in acc["session"]["status"]
print("OK Human Accept path (not agent_judge_pass alone)")
PY

# Second session — high-score strategy should retrieve into plan context
curl -sf -X POST "${BASE}/v1/sessions" -H "Content-Type: application/json" \
  -H "X-SightLoop-Token: ${TOKEN}" \
  -d "$(python3 -c "import json; print(json.dumps({
  'project_id':'${PROJECT_ID}','page_url':'http://127.0.0.1:5175/',
  'sniff':{'framework':'unknown','selector':'[data-testid=gate-ok]'},
  'annotation':{'note':'gate-ok login form','selector':'[data-testid=gate-ok]'},
}))")" >/tmp/m12a-sess2.json
SESSION2="$(python3 -c 'import json;print(json.load(open("/tmp/m12a-sess2.json"))["session"]["id"])')"

curl -sf -X POST "${BASE}/v1/sessions/${SESSION2}/start" \
  -H "Content-Type: application/json" -H "X-SightLoop-Token: ${TOKEN}" \
  -d '{}' >/tmp/m12a-start2.json

curl -sf "${BASE}/v1/sessions/${SESSION2}" -H "X-SightLoop-Token: ${TOKEN}" >/tmp/m12a-get2.json
python3 - <<'PY'
import json
body=json.load(open("/tmp/m12a-get2.json"))
plan=body.get("plan") or {}
root=plan.get("root_cause") or ""
steps=body.get("steps") or []
# strategy hit appears in plan root_cause note or plan step output
hit=False
if "strategy" in root.lower() or "strat-" in root.lower():
  hit=True
for st in steps:
  out=st.get("output") or {}
  if isinstance(out, dict) and out.get("strategy_hits"):
    # R1: noise-only low score should not be injected when min score applies
    titles=[h.get("title","") for h in out["strategy_hits"]]
    assert not any("noise-only" in t for t in titles), titles
    hit=True
assert hit, ("expected strategy retrieve in plan context", root, [s.get("phase") for s in steps])
print("OK strategy retrieved into plan context")
PY

echo "SMOKE M12a OK PROJECT=$PROJECT_ID"
