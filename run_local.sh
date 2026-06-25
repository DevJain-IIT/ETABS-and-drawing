#!/usr/bin/env bash
# Run the whole app locally: FastAPI backend (8000) + Next.js frontend (3000).
# Uses SQLite + local disk (no Supabase needed). Ctrl-C stops both.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"

# Ports 8765/3456 chosen to avoid colliding with other local projects.
echo "== CivilSpace Rosetta — local =="
echo "backend  -> http://localhost:8765  (docs: /docs)"
echo "frontend -> http://localhost:3456"
echo

# backend
( cd "$HERE/backend" && uvicorn app:app --port 8765 --reload ) &
BACK=$!

# frontend in PRODUCTION mode (build once, then serve) — pre-compiled, so it
# avoids the Next.js dev-mode "Jest worker" compile crash on heavy pages.
( cd "$HERE/frontend" && NEXT_PUBLIC_API_BASE=http://localhost:8765 npm run build && npm run start -- --port 3456 ) &
FRONT=$!

trap 'echo; echo "stopping…"; kill $BACK $FRONT 2>/dev/null' INT TERM
wait
