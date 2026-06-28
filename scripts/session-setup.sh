#!/usr/bin/env bash
# SessionStart hook: bring the project to a runnable state in a fresh web
# session — Postgres up, dependencies installed, schema migrated & seeded.
# Idempotent and best-effort: it never hard-fails the session.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 0

log() { echo "[session-setup] $*"; }

# 1. Ensure a local Postgres is running (cluster created by the image).
if command -v pg_ctlcluster >/dev/null 2>&1; then
  if ! pg_isready -q 2>/dev/null; then
    log "starting postgres cluster"
    pg_ctlcluster 16 main start >/dev/null 2>&1 || true
  fi
  # Create the app role + database if missing.
  su - postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='stock'\"" 2>/dev/null | grep -q 1 \
    || su - postgres -c "psql -c \"CREATE ROLE stock LOGIN PASSWORD 'stock';\"" >/dev/null 2>&1 || true
  su - postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='stockdb'\"" 2>/dev/null | grep -q 1 \
    || su - postgres -c "createdb -O stock stockdb" >/dev/null 2>&1 || true
fi

# 2. Ensure .env exists (copy from example on first run).
[ -f .env ] || { [ -f .env.example ] && cp .env.example .env && log "created .env from example"; }

# 3. Install dependencies if missing.
if [ ! -d node_modules ]; then
  log "installing dependencies"
  npm ci >/dev/null 2>&1 || npm install >/dev/null 2>&1 || true
fi

# 4. Apply migrations and seed reference data.
if [ -d node_modules ]; then
  log "applying migrations"
  npx drizzle-kit migrate >/dev/null 2>&1 || true
  log "seeding"
  npm run db:seed >/dev/null 2>&1 || true
fi

log "ready"
exit 0
