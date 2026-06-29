#!/bin/sh
# Container entrypoint: apply DB migrations, then start the Next.js server.
set -e
echo "[entrypoint] running migrations…"
node scripts/migrate.mjs
echo "[entrypoint] starting server…"
exec node server.js
