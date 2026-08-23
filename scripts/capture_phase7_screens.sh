#!/usr/bin/env bash
# Capture Phase 7 screenshots + Lighthouse accessibility (local preview).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHOT="$ROOT/docs/screenshots"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BASE="${PREVIEW_BASE:-http://127.0.0.1:4173}"
mkdir -p "$SHOT"

shot() {
  local name="$1"
  local path="$2"
  echo "screenshot $name <- $path"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --window-size=1440,1100 \
    --virtual-time-budget=20000 \
    --screenshot="$SHOT/$name.png" \
    "$BASE$path" >/dev/null 2>&1 || true
}

# Phoenix live — matches README product shots (wait for assess to finish if you re-run)
shot "phoenix_verdict" "/?lat=33.45&lon=-112.07&theme=sunlight&workload=moderate&profile=general"
shot "cams_map" "/?lat=33.45&lon=-112.07&theme=sunlight&workload=moderate&profile=general"

echo "lighthouse accessibility…"
npx --yes lighthouse "$BASE/?lat=47.61&lon=-122.33&theme=ops" \
  --only-categories=accessibility \
  --chrome-flags="--headless=new --no-sandbox" \
  --quiet --output=json --output-path="$SHOT/lighthouse_ops.json" || true
npx --yes lighthouse "$BASE/?lat=47.61&lon=-122.33&theme=sunlight" \
  --only-categories=accessibility \
  --chrome-flags="--headless=new --no-sandbox" \
  --quiet --output=json --output-path="$SHOT/lighthouse_sunlight.json" || true
npx --yes lighthouse "$BASE/?lat=47.61&lon=-122.33&text=1" \
  --only-categories=accessibility \
  --chrome-flags="--headless=new --no-sandbox" \
  --quiet --output=json --output-path="$SHOT/lighthouse_text.json" || true

python3 - <<'PY'
import json
from pathlib import Path
shot = Path("docs/screenshots")
for name in ("lighthouse_ops", "lighthouse_sunlight", "lighthouse_text"):
    p = shot / f"{name}.json"
    if not p.exists():
        print(f"{name}: missing")
        continue
    d = json.loads(p.read_text())
    score = d["categories"]["accessibility"]["score"]
    print(f"{name}: accessibility={score*100:.0f}")
PY
