#!/usr/bin/env bash
# Backup harian CBT: dump PostgreSQL + arsip gambar soal (volume uploads).
#
# Pakai:
#   cd /opt/cbt
#   ./deploy/backup.sh
#
# Jadwal cron (user yang boleh menjalankan docker):
#   0 23 * * * cd /opt/cbt && ./deploy/backup.sh >> /var/log/cbt-backup.log 2>&1
#
# Simpan hasil backup juga di luar VM (Proxmox Backup Server / NFS / object
# storage). Backup yang hanya ada di VM yang sama bukan backup yang aman.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.prod.yml"
ENV_FILE="$ROOT/.env.production"
DEST="${BACKUP_DIR:-$ROOT/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

compose() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE tidak ditemukan." >&2
  exit 1
fi

mkdir -p "$DEST"
chmod 700 "$DEST"

DB_TMP="$DEST/.cbt-$STAMP.dump.part"
UP_TMP="$DEST/.uploads-$STAMP.tar.gz.part"
trap 'rm -f "$DB_TMP" "$UP_TMP"' EXIT

echo "[backup] dump PostgreSQL..."
compose exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$DB_TMP"
mv "$DB_TMP" "$DEST/cbt-$STAMP.dump"

echo "[backup] arsip uploads..."
compose exec -T api tar czf - -C /app/uploads . > "$UP_TMP"
mv "$UP_TMP" "$DEST/uploads-$STAMP.tar.gz"

echo "[backup] hapus backup lebih dari $RETENTION_DAYS hari..."
find "$DEST" -maxdepth 1 -type f \
  \( -name 'cbt-*.dump' -o -name 'uploads-*.tar.gz' \) \
  -mtime +"$RETENTION_DAYS" -delete

echo "[backup] selesai:"
ls -lh "$DEST/cbt-$STAMP.dump" "$DEST/uploads-$STAMP.tar.gz"
