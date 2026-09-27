#!/bin/sh
# Task 24 Step 1 — postgres backup loop for the production compose stack.
#
# Runs inside the postgres-backup sidecar (postgres:16-alpine image, so pg_dump
# always MATCHES the server's major version). One pass at container start, then
# every 24h, writing custom-format dumps (selective-restore friendly) to
# $BACKUP_DIR (mounted to ./backups on the host) and pruning archives older
# than $BACKUP_KEEP_DAYS days.
#
#   Backup at boot  → a running sidecar is itself the "a backup exists" signal.
#   Usage (one-shot from the host — entrypoint already is `/bin/sh /backup.sh`,
#   so the service name is followed only by the `once` argument):
#     docker compose -f docker-compose.prod.yml run --rm postgres-backup once
#
# Keep this file LF-only (*.sh text eol=lf in .gitattributes — CRLF breaks sh).
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
DATABASES="openfront openship"

run_backup() {
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  for db in $DATABASES; do
    out="$BACKUP_DIR/${db}_${stamp}.dump"
    echo "[backup] dumping $db -> $out"
    # -Fc: custom format (compressed, pg_restore-selective capable).
    pg_dump -Fc -d "$db" -f "$out"
  done
  echo "[backup] pruning archives older than ${KEEP_DAYS}d in $BACKUP_DIR"
  find "$BACKUP_DIR" -type f -name '*.dump' -mtime "+$KEEP_DAYS" -delete
  echo "[backup] done:" && ls -1 "$BACKUP_DIR" | tail -n 5 || true
}

run_backup

# "once" = run a single pass and exit (host-invoked verification); otherwise
# keep the sidecar alive on a daily cadence.
if [ "${1:-}" = "once" ]; then
  exit 0
fi

while sleep 86400; do
  run_backup
done
