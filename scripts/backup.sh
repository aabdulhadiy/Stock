#!/usr/bin/env bash
# Take a database backup right now (§14).
#
# Writes a compressed custom-format dump into the `backups` volume, copies it to
# the off-server mount, and prunes anything past the retention window.
#
#   bash scripts/backup.sh
#
# The `backup` service runs the same logic on a daily schedule; this script is
# for taking one on demand — before an upgrade, say.
set -euo pipefail
cd "$(dirname "$0")/.."

STAMP="$(date -u +%Y%m%d-%H%M%SZ)"
FILE="stockdb-${STAMP}.dump"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

echo "▶ Backing up to ${FILE}"

# pg_dump runs inside the backup container, which already has the credentials
# and network access. -Fc is the custom format: compressed, and restorable
# selectively with pg_restore.
docker compose exec -T backup sh -c "
  set -e
  pg_dump -Fc -f '/backups/${FILE}'
  cp '/backups/${FILE}' '/offsite/${FILE}'
  # Prune both locations together, so they cannot drift apart.
  find /backups /offsite -name 'stockdb-*.dump' -type f -mtime +${RETENTION_DAYS} -delete
  ls -lh '/backups/${FILE}'
"

echo "✓ Backup complete: ${FILE}"
echo "  in the backups volume and on the off-server mount"
echo "  retention: ${RETENTION_DAYS} days"
