# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# CBT SMAN 1 Gorontalo — Web (React + Vite) disajikan nginx.
# nginx juga mem-proxy /api dan /uploads ke container `api` (same-origin,
# jadi bebas masalah CORS). Build context: root repo.
# ---------------------------------------------------------------------------

# --- Tahap build: build shared + web statis --------------------------------
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @cbt/shared \
 && npm run build -w @cbt/web

# --- Tahap runtime: nginx menyajikan dist + proxy API ----------------------
FROM nginx:alpine AS runtime
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
