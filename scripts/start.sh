#!/usr/bin/env bash
# Serve the production build locally, the same way the container does.
#
#   npm run build && npm start
#
# `next start` does not support `output: "standalone"` — it prints a warning and
# can serve stale client assets from an earlier build, which looks like a broken
# app (buttons that do nothing) rather than a stale copy. This script runs the
# standalone server and refreshes `public` and `.next/static` first, which is the
# copy step the Dockerfile performs at build time.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .next/standalone/server.js ]; then
  echo "✗ No standalone build found. Run 'npm run build' first." >&2
  exit 1
fi

# Refresh the assets the standalone server serves, so they always match the
# build that produced them.
rm -rf .next/standalone/public .next/standalone/.next/static
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/

export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"

echo "▶ http://localhost:${PORT}"
cd .next/standalone && exec node server.js
