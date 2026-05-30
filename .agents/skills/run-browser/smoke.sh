#!/usr/bin/env bash
# Launch the CodeCharter viewer and drive it with agent-browser: screenshot,
# console-error check, and Core Web Vitals. Exits non-zero if the page logs a
# console error. This is the end-to-end harness the run-browser skill points at.
#
# Usage:  .agents/skills/run-browser/smoke.sh [PORT] [OUT_DIR]
#   PORT     viewer port (default 4173)
#   OUT_DIR  where screenshots land (default .scratch/run-browser)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

PORT="${1:-4173}"
OUT="${2:-.scratch/run-browser}"
URL="http://127.0.0.1:${PORT}/"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"   # agent-browser screenshot honors only ABSOLUTE paths

# Generate the Map Sidecar if missing (serve does not regenerate).
[ -f .codecharter/codecharter.json ] || pnpm generate >/dev/null 2>&1

echo "▶ launching viewer on :${PORT}"
pnpm codecharter -- serve --port "$PORT" >/tmp/run-browser-serve.log 2>&1 &
SERVE_PID=$!
cleanup() { agent-browser close --all >/dev/null 2>&1; kill "$SERVE_PID" 2>/dev/null; }
trap cleanup EXIT

# Wait for the server to answer.
for _ in $(seq 1 50); do
  curl -fsS -o /dev/null "$URL" 2>/dev/null && break
  sleep 0.3
done
curl -fsS -o /dev/null "$URL" || { echo "✗ server never came up"; cat /tmp/run-browser-serve.log; exit 1; }

echo "▶ driving viewer with agent-browser"
agent-browser open "$URL" >/dev/null
agent-browser wait --load networkidle >/dev/null
agent-browser screenshot "$OUT/initial.png" >/dev/null
echo "  screenshot -> $OUT/initial.png"

ERRORS=$(agent-browser console --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s).data?.messages||[];console.log(m.filter(x=>x.type==="error").length)})')
echo "  console errors: ${ERRORS}"

echo "▶ Core Web Vitals"
agent-browser vitals --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).data?.report||""))'
echo

if [ "${ERRORS:-0}" != "0" ]; then
  echo "✗ viewer logged ${ERRORS} console error(s)"; exit 1
fi
echo "✓ run-browser smoke passed"
