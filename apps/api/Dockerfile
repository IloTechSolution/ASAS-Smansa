# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# CBT SMAN 1 Gorontalo — API (NestJS + Prisma + PostgreSQL + Redis)
# Build context: root repo (npm workspaces monorepo).
# ---------------------------------------------------------------------------

# --- Tahap build: install semua workspace, build shared + api -------------
FROM node:20-alpine AS build
WORKDIR /app
# openssl & libc6-compat dibutuhkan engine Prisma di Alpine (musl).
RUN apk add --no-cache openssl libc6-compat

# Salin manifest dulu agar layer cache npm ci stabil.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

# Salin sumber yang diperlukan lalu build shared → generate prisma → build api.
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @cbt/shared \
 && npm run prisma:generate -w @cbt/api \
 && npm run build -w @cbt/api \
 && npm prune --omit=dev \
 && mkdir -p apps/api/node_modules packages/shared/node_modules

# --- Tahap runtime: hanya artefak + node_modules produksi -------------------
FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat tini tzdata su-exec
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
# Aset sekolah (logo SMAN 1) — dipakai seed untuk menyalin ke volume uploads.
COPY --from=build /app/apps/api/assets ./apps/api/assets

WORKDIR /app/apps/api
# Folder upload gambar soal; bisa di-mount volume agar persist.
# Dimiliki user node — container berjalan non-root.
RUN mkdir -p /app/uploads/questions /app/uploads/branding && chown -R node:node /app/uploads
ENV UPLOAD_DIR=/app/uploads
EXPOSE 3000

# migrate deploy (idempoten) → seed (upsert, idempoten) → jalankan API.
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
