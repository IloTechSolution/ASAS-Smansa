# Deploy cepat — CBT SMAN 1 Gorontalo

Panduan ini untuk men-deploy dari **clone GitHub kosong** ke server Linux.
Panduan lengkap ada di [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) (manual/LAN)
dan [`docs/DEPLOYMENT-PROXMOX.md`](docs/DEPLOYMENT-PROXMOX.md) (image VM).

## 1. Prasyarat server

Ubuntu Server 24.04 LTS · minimal 2 vCPU / 4 GB RAM / 60 GB disk
(direkomendasikan 4 vCPU / 8 GB / 100 GB) · IP statis · user dengan `sudo`.
Buka port **22** dan **80** (＋443 bila pakai HTTPS). **Jangan** buka 5432/6379.

```bash
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
# logout/login lagi, lalu verifikasi:
docker version && docker compose version
```

## 2. Clone + konfigurasi rahasia

```bash
sudo mkdir -p /opt/cbt && sudo chown "$USER":"$USER" /opt/cbt
git clone <URL-REPO-GITHUB> /opt/cbt
cd /opt/cbt

cp deploy/env.production.example .env.production
chmod 600 .env.production
```

Generate nilai rahasia (jalankan di server, lalu tempel ke `.env.production`):

```bash
openssl rand -hex 24   # POSTGRES_PASSWORD
openssl rand -hex 32   # JWT_SECRET
openssl rand -base64 24 # SEED_ADMIN_PASSWORD
```

Wajib diisi / dicek di `.env.production`:

| Variabel | Catatan |
|---|---|
| `POSTGRES_PASSWORD` | hex 24; hanya dipakai saat volume DB pertama dibuat |
| `JWT_SECRET` | hex 32, jangan pakai nilai dev |
| `SEED_ADMIN_PASSWORD` | password admin awal; **ganti lagi lewat UI setelah login** |
| `SEED_DEMO` | `false` (jangan pernah `true` di produksi) |
| `CORS_ORIGIN` | persis sama dengan alamat browser, tanpa trailing `/` |
| `WEB_URL` | alamat publik/LAN, dipakai QR kartu login; contoh `http://192.168.1.50` atau `https://cbt.sekolah.sch.id` |
| `INITIAL_PASSWORD_SECRET`, `PIN_HASH_SECRET` | opsional, hex 32; kosong = turunan dari `JWT_SECRET` |
| `DEFAULT_SCHOOL_SLUG` | default `sman1` |
| `SEB_BROWSER_EXAM_KEY` | isi bila ada sesi wajib SEB; kosong = sesi SEB ditolak (fail-closed) |

`TZ=Asia/Makassar` sudah sesuai WITA. `.env.production` **jangan pernah di-commit**.

## 3. Build + jalankan

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production config >/dev/null
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production ps
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api
```

Saat `api` pertama kali jalan, entrypoint melakukan `prisma migrate deploy` →
`prisma seed` (idempoten) → start server. Tunggu healthcheck hijau.

```bash
curl -fsS http://127.0.0.1/api/health   # {"status":"ok",...}
curl -I http://127.0.0.1/
```

Buka `http://<IP-SERVER>/`, login dengan `SEED_ADMIN_USERNAME` /
`SEED_ADMIN_PASSWORD`.

## 4. HTTPS (opsional, direkomendasikan)

A record DNS → IP server, forward port 80/443, lalu di `.env.production`:

```
CORS_ORIGIN=https://cbt.sekolah.sch.id
WEB_URL=https://cbt.sekolah.sch.id
WEB_BIND=127.0.0.1
WEB_PORT=8080
```

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d web
sudo ufw allow 443/tcp
# pasang Caddy: reverse_proxy 127.0.0.1:8080
```

Jangan biarkan `WEB_BIND=0.0.0.0` saat Caddy/Nginx host dipakai.

## 5. Backup & restore

```bash
cd /opt/cbt && chmod +x deploy/backup.sh
./deploy/backup.sh                       # dump PG + arsip uploads
RETENTION_DAYS=30 ./deploy/backup.sh
# cron harian:
# 0 23 * * * cd /opt/cbt && ./deploy/backup.sh >> /var/log/cbt-backup.log 2>&1
```

Backup default di `/opt/cbt/backups` (retensi 14 hari). **Salin ke luar server**
(PBS/NFS/USB) dan latih restore sebelum ujian.

## 6. Hal penting

- **Jangan** `docker compose ... down -v` di produksi — menghapus volume `pgdata`, Redis, dan uploads.
- `POSTGRES_PASSWORD` tidak mengubah DB yang sudah ada; ubah via `ALTER USER` bila perlu.
- Seed **tidak menimpa** admin/config yang sudah diedit, dan **tidak menghapus** akun demo lama.
- Port 5432/6379 tetap internal; akses admin dari luar sebaiknya lewat VPN.
- Cek waktu server: `timedatectl` (WITA + NTP aktif).
- Sumber APK kiosk SEB ada di `apps/seb-android`. Keystore (`key.jks`, `key.properties`)
  dan `local.properties` **sengaja tidak disertakan** — harus dibuat di mesin build sendiri.

## 7. Dokumentasi lain

- `docs/DEPLOYMENT.md` — panduan lengkap, hardening, restore drill, troubleshooting
- `docs/DEPLOYMENT-PROXMOX.md` — import image VM ke Proxmox
- `docs/PANDUAN-OPERATOR.md` — panduan proktor/operator ujian
- `docs/API.md`, `docs/ERD.md`, `docs/PRD.md` — referensi teknis
- `docs/SEB-ANDROID.md` — build & konfigurasi APK kiosk SEB
