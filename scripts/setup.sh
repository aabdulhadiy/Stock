#!/usr/bin/env bash
# One-command local setup: Postgres (via Docker) + schema + seed data.
# After this finishes, run `npm run dev` and open http://localhost:3000.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▶ Toy Inventory — local setup"

# 1. Ensure a .env exists.
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  • created .env from .env.example (set AUTH_SECRET before deploying)"
fi

# 2. Start Postgres via Docker if available; otherwise assume one is running.
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo "  • starting Postgres (docker compose up -d db)…"
  docker compose up -d db || echo "  ! could not start the docker db — is Docker running?"
else
  echo "  • Docker not found — assuming a Postgres matching DATABASE_URL is already running"
fi

# 3. Wait until Postgres accepts connections (max ~30s).
echo "  • waiting for Postgres…"
for _ in $(seq 1 30); do
  if { command -v pg_isready >/dev/null 2>&1 && pg_isready -q; } \
     || docker compose exec -T db pg_isready -U stock -d stockdb >/dev/null 2>&1; then
    echo "  • Postgres is ready"
    break
  fi
  sleep 1
done

# 4. Install dependencies if needed.
if [ ! -d node_modules ]; then
  echo "  • installing dependencies…"
  npm install
fi

# 5. Apply schema and seed reference data.
echo "  • applying migrations…"
npm run db:migrate
echo "  • seeding…"
npm run db:seed

cat <<'DONE'

✓ Setup complete.

  Start the app:   npm run dev
  Then open:       http://localhost:3000
  Log in as admin: admin@toy.local / admin12345
DONE
