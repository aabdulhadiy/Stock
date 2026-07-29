#!/usr/bin/env bash
# Restore the database from a backup (§16.3 — demonstrated live at acceptance).
#
#   bash scripts/restore.sh                       # list available backups
#   bash scripts/restore.sh stockdb-2026-07-29.dump
#
# This REPLACES the current database contents. It stops the app first so nothing
# writes mid-restore, takes a safety dump of the current state, restores, then
# starts the app again.
set -euo pipefail
cd "$(dirname "$0")/.."

FILE="${1:-}"

if [ -z "${FILE}" ]; then
  echo "Available backups:"
  echo
  docker compose exec -T backup sh -c "ls -lht /backups/*.dump 2>/dev/null" || {
    echo "  (none — is the backup service running?)"
    exit 1
  }
  echo
  echo "Usage: bash scripts/restore.sh <filename>"
  exit 0
fi

# Accept either a bare filename or a path inside the container.
BASENAME="$(basename "${FILE}")"

if ! docker compose exec -T backup sh -c "test -f '/backups/${BASENAME}'"; then
  echo "✗ /backups/${BASENAME} not found. Run 'bash scripts/restore.sh' to list backups." >&2
  exit 1
fi

cat <<WARNING

⚠  This will REPLACE the current database with ${BASENAME}.
   Everything recorded since that backup was taken will be lost.

WARNING

read -r -p "Type RESTORE to continue: " CONFIRM
if [ "${CONFIRM}" != "RESTORE" ]; then
  echo "Aborted; nothing changed."
  exit 1
fi

echo "▶ Stopping the app so nothing writes during the restore…"
docker compose stop app

# A safety net: if the restore turns out to be the wrong file, the state we just
# replaced is still on disk.
SAFETY="pre-restore-$(date -u +%Y%m%d-%H%M%SZ).dump"
echo "▶ Dumping current state to ${SAFETY} first…"
docker compose exec -T backup sh -c "pg_dump -Fc -f '/backups/${SAFETY}'"

echo "▶ Restoring ${BASENAME}…"
# --clean --if-exists drops existing objects before recreating them, so the
# restore is a replacement rather than a merge. Ownership and privileges come
# from the target role, not the dump.
docker compose exec -T backup sh -c "
  pg_restore --clean --if-exists --no-owner --no-privileges \
             --dbname \"\$PGDATABASE\" '/backups/${BASENAME}'
" || {
  echo
  echo "✗ pg_restore reported errors. Note that 'does not exist, skipping'"
  echo "  notices are normal on a --clean restore into an empty database."
  echo "  The pre-restore snapshot is /backups/${SAFETY}."
  echo
}

echo "▶ Starting the app…"
docker compose start app

echo "▶ Waiting for the health check…"
for _ in $(seq 1 30); do
  if docker compose exec -T app node -e \
    "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    2>/dev/null; then
    echo
    echo "✓ Restore complete and the app is healthy."
    echo "  Pre-restore snapshot kept as ${SAFETY}."
    exit 0
  fi
  sleep 2
done

echo "✗ The app did not become healthy. Check 'docker compose logs app'." >&2
echo "  Pre-restore snapshot kept as ${SAFETY}." >&2
exit 1
