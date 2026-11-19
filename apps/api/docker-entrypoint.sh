#!/bin/sh
set -e

# Volume uploads bisa root-owned dari run sebelumnya / pembuatan volume baru —
# perbaiki kepemilikan lalu turun ke user `node` untuk semua langkah berikut.
chown -R node:node /app/uploads 2>/dev/null || true

echo "[cbt-api] Menjalankan migrasi Prisma (migrate deploy)..."
su-exec node npx prisma migrate deploy

echo "[cbt-api] Menjalankan seed (idempoten)..."
su-exec node npx tsx prisma/seed.ts

echo "[cbt-api] Memulai API (user node)..."
exec su-exec node "$@"
