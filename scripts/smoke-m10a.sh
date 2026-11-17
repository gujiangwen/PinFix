#!/usr/bin/env bash
# Smoke M10a: DX github credential health fields (no secrets leaked)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

BASE="http://127.0.0.1:7420"

echo "== health =="
curl -sf "${BASE}/health" | tee /tmp/sightloop-m10a-health.json
echo
VERSION="$(python3 -c 'import json; print(json.load(open("/tmp/sightloop-m10a-health.json")).get("version",""))')"
echo "VERSION=$VERSION"

echo "== dx github =="
curl -sf "${BASE}/v1/dx/status" | tee /tmp/sightloop-m10a-dx.json
echo
python3 - <<'PY'
import json, re
d = json.load(open("/tmp/sightloop-m10a-dx.json"))
gh = d.get("github")
assert gh is not None, d
for k in ("gh_cli_present", "authenticated", "login", "git_push_ready", "heal_hint"):
    assert k in gh, (k, gh)
blob = json.dumps(d)
assert not re.search(r"ghs_[A-Za-z0-9]{10,}", blob), "token leaked in dx status"
assert "x-access-token:" not in blob.lower()
print("OK github dx", {k: gh.get(k) for k in (
  "gh_cli_present","authenticated","login","git_push_ready")})
if not gh.get("authenticated"):
    assert gh.get("heal_hint"), "heal_hint required when unauthenticated"
    print("OK heal_hint present")
PY

echo "== github-probe =="
curl -sf -X POST "${BASE}/v1/dx/github-probe" | tee /tmp/sightloop-m10a-probe.json
echo
python3 - <<'PY'
import json
d = json.load(open("/tmp/sightloop-m10a-probe.json"))
assert "github" in d and "authenticated" in d["github"]
print("OK probe", d["github"].get("authenticated"))
PY

echo
echo "SMOKE M10a OK"
echo "VERSION=$VERSION"
