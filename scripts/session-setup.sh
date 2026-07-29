#!/usr/bin/env bash
# Bring a fresh environment to a runnable state: PostgreSQL, dependencies,
# schema, seed data. Safe to re-run.
#
# Intended for a Claude Code SessionStart hook, but it works standalone too.
set -uo pipefail
cd "$(dirname "$0")/.."

echo "▶ Preparing the Warehouse & Sales environment"

# 1. .env
if [ ! -f .env ]; then
  cp .env.example .env
  # A dev-only secret, so the app starts without manual editing. Production
  # values belong in a real .env — see docs/RUNBOOK.md.
  sed -i 's|^AUTH_SECRET=.*|AUTH_SECRET="dev-only-secret-not-for-production-0123456789abcdef"|' .env
  echo "  • created .env (dev AUTH_SECRET; set a real one before deploying)"
fi

# 2. PostgreSQL: prefer a local server, fall back to Docker.
if command -v pg_isready >/dev/null 2>&1 && pg_isready -q 2>/dev/null; then
  echo "  • PostgreSQL already accepting connections"
elif command -v pg_ctlcluster >/dev/null 2>&1; then
  echo "  • starting the local PostgreSQL cluster…"
  service postgresql start >/dev/null 2>&1 || pg_ctlcluster 16 main start >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do pg_isready -q 2>/dev/null && break; sleep 1; done
elif command -v docker >/dev/null 2>&1; then
  echo "  • starting PostgreSQL via Docker…"
  docker compose up -d db >/dev/null 2>&1 || echo "  ! could not start the Docker database"
  for _ in $(seq 1 30); do
    docker compose exec -T db pg_isready -q >/dev/null 2>&1 && break
    sleep 1
  done
fi

# 3. Role and database, if a local cluster is being used.
if command -v psql >/dev/null 2>&1 && pg_isready -q 2>/dev/null; then
  su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='stock'\"" 2>/dev/null | grep -q 1 \
    || su postgres -c "psql -q -c \"CREATE ROLE stock LOGIN PASSWORD 'stock' SUPERUSER\"" 2>/dev/null \
    || true
  su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='stockdb'\"" 2>/dev/null | grep -q 1 \
    || su postgres -c "psql -q -c 'CREATE DATABASE stockdb OWNER stock'" 2>/dev/null \
    || true
fi

# 4. Dependencies.
[ -d node_modules ] || { echo "  • installing dependencies…"; npm install --silent; }

# 5. Schema and reference data.
echo "  • applying migrations…"
npm run db:migrate --silent >/dev/null 2>&1 && echo "    done" || echo "    ! migrations failed"
echo "  • seeding…"
npm run db:seed --silent >/dev/null 2>&1 && echo "    done" || echo "    ! seed failed"

cat <<'DONE'

✓ Ready.

  npm run dev     http://localhost:3000
  npm test        the full suite
DONE
