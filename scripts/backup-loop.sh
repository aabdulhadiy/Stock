#!/bin/sh
# Daily backup loop for the `backup` service (§14).
#
# A plain sleep loop rather than cron: the container has one job, the schedule is
# a single number, and this way the schedule and its log go to `docker compose
# logs backup` like everything else.
#
# Runs one backup immediately on start, so a fresh deployment has a restorable
# dump within seconds rather than waiting until tomorrow.
set -eu

RETENTION_DAYS="${RETENTION_DAYS:-30}"
BACKUP_HOUR="${BACKUP_HOUR:-2}"

log() {
  echo "[backup $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

take_backup() {
  stamp="$(date -u +%Y%m%d-%H%M%SZ)"
  file="stockdb-${stamp}.dump"

  if pg_dump -Fc -f "/backups/${file}"; then
    size="$(du -h "/backups/${file}" | cut -f1)"
    log "wrote /backups/${file} (${size})"
  else
    # Do not delete anything if the dump failed — old backups are all we have.
    log "ERROR: pg_dump failed; keeping existing backups untouched"
    return 1
  fi

  if cp "/backups/${file}" "/offsite/${file}" 2>/dev/null; then
    log "copied to off-server mount"
  else
    log "WARNING: could not write to /offsite — backups exist on this host only"
  fi

  # Prune only after a successful dump, so a run of failures cannot age out the
  # last good backup.
  deleted="$(find /backups /offsite -name 'stockdb-*.dump' -type f -mtime "+${RETENTION_DAYS}" -print -delete 2>/dev/null | wc -l)"
  [ "${deleted}" -gt 0 ] && log "pruned ${deleted} backups older than ${RETENTION_DAYS} days"
  return 0
}

log "starting; daily at ${BACKUP_HOUR}:00 UTC, retention ${RETENTION_DAYS} days"
mkdir -p /backups /offsite

# One immediately, so there is always something to restore from.
take_backup || true

while :; do
  # Sleep until the next occurrence of BACKUP_HOUR:00 UTC.
  now_h="$(date -u +%H)"
  now_m="$(date -u +%M)"
  # Strip any leading zero so arithmetic does not read these as octal.
  now_h="${now_h#0}"
  now_m="${now_m#0}"
  : "${now_h:=0}" "${now_m:=0}"

  minutes_now=$((now_h * 60 + now_m))
  minutes_target=$((BACKUP_HOUR * 60))
  wait_minutes=$((minutes_target - minutes_now))
  [ "${wait_minutes}" -le 0 ] && wait_minutes=$((wait_minutes + 1440))

  log "next backup in ${wait_minutes} minutes"
  sleep $((wait_minutes * 60))

  take_backup || log "backup run failed; will retry tomorrow"
done
