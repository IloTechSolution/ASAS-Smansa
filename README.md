# CBT SMAN 1 Gorontalo

Aplikasi ujian online (CBT) untuk SMAN 1 & SMAN 8 Gorontalo — modul ujian
jujur untuk siswa dengan pengawas (proktor), guru penilai, dan admin sekolah.

**Stack**: NestJS + Prisma + PostgreSQL + Redis + Socket.io (API) · React + Vite + Tailwind (Web) · Flutter (APK kiosk SEB)

> **Deploy ke server**: mulai dari [`DEPLOY-QUICKSTART.md`](DEPLOY-QUICKSTART.md) (clone → `.env.production` → docker compose).

## Quick start (Docker)

```bash
cp .env.example .env
docker compose up -d --build
# buka http://localhost:8080
```

Akun seed (dev): `admin`/`Admin123!` · `guru`/`Guru123!` · `proktor`/`Proktor123!` · `0051234567`/`Siswa123!` (SMAN 8: `guru8`, `proktor8`, `0081234567`).

- Health: `GET http://localhost:8080/api/health` → `{"status":"ok",...}`
- Multi-tenant: SMAN 1 & SMAN 8 dalam satu instalasi (switcher sekolah untuk ADMIN).
- APK kiosk SEB: `apps/seb-android` (Flutter) — lihat `docs/SEB-ANDROID.md`.

## Struktur

```
apps/api          NestJS API (@cbt/api) — Prisma, JWT, Socket.io gateway
apps/web          React SPA (@cbt/web) — Vite, Tailwind, design system gelap
apps/seb-android  Flutter kiosk APK SEB — screen pinning + Bridge hash
packages/shared   @cbt/shared — enum + schema Zod bersama API & Web
deploy            backup.sh, env.production.example, vm/ (image siap jalan)
nginx             reverse proxy + security headers (CSP)
docs              PRD, API, ERD, panduan deploy & operator (Bahasa Indonesia)
```

## Perintah berguna

```bash
npm run build          # build shared + api + web
npm run dev:api        # API dev (tsx watch) — butuh Postgres+Redis (docker compose up -d postgres redis)
npm run dev:web        # Web dev (vite)
npm run lint           # oxlint (web)
npm run seed           # seed akun demo (dev)
npm run e2e            # Playwright smoke (web) — butuh stack dev 8080
```

Catatan instalasi lokal: `prisma generate` (postinstall) sudah di-allow-list lewat `allowScripts`
di `package.json` (bersama esbuild) — jadi `npm install` biasa tetap menghasilkan Prisma Client
yang lengkap. Bila client terasa stale: `npm run prisma:generate -w @cbt/api`.

Catatan: folder `scripts/` berisi skrip verifikasi HTTP (verify-*.mjs). Jalankan stack dev, lalu
misal `node scripts/verify-roles.mjs`. Skrip menulis data uji ke DB dev dan membersihkan kembali;
jangan dijalankan bersamaan dengan pemakaian aplikasi. 3 skrip (verify-hari, verify-lock,
encrypt-initial-passwords) hilang permanen — jangan gunakan yang tidak tersedia.

## Deploy produksi

- **VM siap pakai**: `deploy/vm/CBT-SMAN1-Gorontalo.vdi` → lihat `docs/DEPLOYMENT-PROXMOX.md` (Proxmox) atau `docs/DEPLOYMENT-VIRTUALBOX.docx` (VirtualBox).
- **Manual di server Linux**: `docs/DEPLOYMENT.md` (docker-compose.prod.yml + backup.sh + restore drill).

## Keamanan ringkas

- JWT access (15m) + refresh rotation (7d) dengan Redis (`refresh:{jti}`), logout mencabut sesi.
- Rate-limit: login per-IP+per-akun, verifikasi token/PIN per user+sesi, upload divalidasi magic-byte.
- Upload gambar soal disajikan lewat URL bertanda tangan HMAC (TTL 6 jam), bukan publik.
- Excel export/import divalidasi & di-sanitasi (formula injection dicegah), import pakai ExcelJS.
- SEB: `X-SafeExamBrowser-RequestHash` diverifikasi server; APK keluar wajib PIN admin (fail-closed).
