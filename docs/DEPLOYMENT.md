# Deployment Produksi — Proxmox VM + Docker

> Untuk instalasi **manual di Oracle VirtualBox** (buat VM → install Ubuntu klik demi klik → deploy → akses via IP VM), lihat [DEPLOYMENT-VIRTUALBOX.docx](./DEPLOYMENT-VIRTUALBOX.docx).

Panduan ini memasang CBT SMAN 1 Gorontalo di **VM Linux (Ubuntu Server 24.04 LTS) di Proxmox**, sehingga:

- server bisa diatur lewat **SSH** (`ssh cbtadmin@IP-VM`), dan
- aplikasi bisa dibuka dari browser guru/siswa lewat **`http://IP-VM`** (atau domain + HTTPS).

> SSH dipakai untuk administrasi server. Aplikasi CBT tetap dibuka lewat browser.
> Bila port web tidak boleh dibuka, lihat §10.3 (SSH tunnel).
>
> Semua instalasi dilakukan **di dalam VM**, bukan di host Proxmox. SSH ke host
> Proxmox (`root@IP-Proxmox`) berbeda dari SSH ke VM (`cbtadmin@IP-VM`).

Dokumen terkait: [PRD](./PRD.md) · [ERD](./ERD.md) · [API](./API.md) · [README](../README.md)

---

## 0. Arsitektur yang akan dipasang

```text
PC/Laptop sekolah ──HTTP/HTTPS──▶ VM Ubuntu (Proxmox)
                                   │
                                   └─ Docker Compose (cbt-prod)
                                        ├─ web   nginx :80  ← satu-satunya port publik
                                        │    ├─ /            SPA React
                                        │    ├─ /api/        proxy ke api:3000
                                        │    ├─ /uploads/    proxy ke api:3000
                                        │    └─ /socket.io/  WebSocket monitoring
                                        ├─ api   NestJS :3000 (internal)
                                        ├─ postgres :5432    (internal, TANPA port host)
                                        └─ redis    :6379    (internal, TANPA port host)
```

Port yang terbuka di VM: **22 (SSH)** dan **80 (HTTP)** — tambah **443** bila memakai HTTPS.
PostgreSQL dan Redis **tidak** diekspos ke LAN/internet.

---

## 1. Prasyarat

| Kebutuhan | Rekomendasi |
| --- | --- |
| Proxmox | PVE 8.x, akses web UI + console |
| ISO | Ubuntu Server 24.04 LTS (amd64) |
| VM | 4 vCPU, 8 GB RAM, disk 100 GB (minimum 2 vCPU/4 GB/60 GB) |
| Jaringan | IP statis/LAN, gateway, DNS; bridge `vmbr0` |
| Akun | user Linux dengan `sudo` (contoh: `cbtadmin`) |
| Domain (opsional) | hanya bila ingin HTTPS, mis. `cbt.sekolah.sch.id` |

Catatan kapasitas: 8 GB RAM cukup untuk sekolah kecil–menengah. Untuk ujian serentak
>100 siswa, pantau `docker stats` dan siapkan 16 GB RAM/8 vCPU. Build pertama butuh
RAM lebih banyak daripada saat berjalan.

---

## 2. Buat VM di Proxmox

1. Unduh ISO Ubuntu Server 24.04 dari situs resmi Ubuntu.
2. Di Proxmox: **Datacenter → node → local (node) → ISO Images → Upload**.
3. Klik **Create VM**:
   - **Name**: `cbt-server`
   - **ISO image**: pilih ISO Ubuntu Server
   - **System**: default; centang **QEMU Guest Agent**
   - **Disks**: 100 GB, bus **VirtIO Block** (atau SCSI VirtIO)
   - **CPU**: 4 cores, type `host`
   - **Memory**: 8192 MB (ballooning boleh aktif)
   - **Network**: bridge `vmbr0`, model **VirtIO**
4. Setelah VM dibuat: **VM → Options → Start at boot = Yes** agar server hidup
   otomatis saat Proxmox reboot.
5. **Start** VM lalu buka **Console**.

---

## 3. Install Ubuntu Server

Ikuti installer:

1. Pilih **Install Ubuntu Server**.
2. Bahasa/keyboard sesuai kebutuhan.
3. Network: sementara DHCP (IP statis diatur di §4.1).
4. Storage: gunakan seluruh disk (LVM default aman).
5. Profil:
   - Nama: `CBT Server`
   - Username: `cbtadmin`
   - Password: kuat (hanya untuk console/sudo; login SSH nanti pakai key)
6. Centang **Install OpenSSH server**.
7. Selesai → reboot → lepas ISO dari VM (Proxmox: **Hardware → CD/DVD → Do not use**).

Login di console, lalu:

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y qemu-guest-agent curl ca-certificates gnupg ufw
sudo systemctl enable --now qemu-guest-agent
sudo hostnamectl set-hostname cbt-server
sudo timedatectl set-timezone Asia/Makassar   # Gorontalo = WITA
sudo timedatectl set-ntp true
timedatectl
```

Waktu server harus akurat: token ujian dan timer bergantung pada jam server.

---

## 4. Jaringan dan akses SSH

### 4.1 IP statis

Cek nama interface:

```bash
ip -br a
```

Biasanya `ens18`. Edit netplan (nama file bisa berbeda, cek `ls /etc/netplan`):

```bash
sudo nano /etc/netplan/50-cloud-init.yaml
```

Contoh (ganti IP/gateway sesuai jaringan sekolah):

```yaml
network:
  version: 2
  ethernets:
    ens18:
      dhcp4: false
      addresses: [192.168.1.50/24]
      routes:
        - to: default
          via: 192.168.1.1
      nameservers:
        addresses: [1.1.1.1, 8.8.8.8]
```

```bash
sudo chmod 600 /etc/netplan/50-cloud-init.yaml
sudo netplan try     # tekan ENTER bila tidak ada error
sudo netplan apply
ip -br a
ping -c 3 1.1.1.1
```

Disarankan juga membuat **DHCP reservation** di router agar IP tidak berubah.

### 4.2 SSH dari komputer admin

Dari Windows PowerShell / Terminal Linux:

```bash
ssh cbtadmin@192.168.1.50
```

Jika berhasil, lanjut pasang SSH key (lebih aman daripada password):

```powershell
# Windows PowerShell — buat key sekali saja
ssh-keygen -t ed25519 -C "cbt-admin"

# Kirim public key ke VM
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh cbtadmin@192.168.1.50 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

# Tes login tanpa password
ssh -i $env:USERPROFILE\.ssh\id_ed25519 cbtadmin@192.168.1.50
```

Linux/macOS:

```bash
ssh-keygen -t ed25519 -C "cbt-admin"
ssh-copy-id cbtadmin@192.168.1.50
ssh cbtadmin@192.168.1.50
```

### 4.3 Hardening SSH

**Pastikan login key sudah berhasil di terminal kedua sebelum menutup password login.**

```bash
sudo tee /etc/ssh/sshd_config.d/99-cbt.conf >/dev/null <<'EOF'
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AllowUsers cbtadmin
EOF

sudo sshd -t
sudo systemctl restart ssh
```

Tes dari komputer admin:

```bash
ssh cbtadmin@192.168.1.50
```

Jika terkunci, buka **Proxmox Console** (bukan SSH) untuk memperbaiki konfigurasi.

### 4.4 Firewall VM

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
# sudo ufw allow 443/tcp   # aktifkan bila memakai HTTPS
sudo ufw enable
sudo ufw status verbose
```

Bila firewall Proxmox (datacenter/node) diaktifkan, tambahkan aturan TCP 22 dan 80/443
untuk VM ini. Jangan buka 5432/6379.

---

## 5. Install Docker Engine + Compose

Ikuti repo resmi Docker untuk Ubuntu:

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker cbtadmin
```

**Logout lalu login lagi** (atau `newgrp docker`) agar grup berlaku, kemudian:

```bash
docker version
docker compose version
docker run --rm hello-world
```

Aktifkan saat boot (biasanya sudah otomatis):

```bash
sudo systemctl enable --now docker
```

---

## 6. Kirim source code ke VM

Pilih salah satu.

### Opsi A — Git (disarankan bila repo tersedia)

```bash
sudo mkdir -p /opt/cbt
sudo chown "$USER":"$USER" /opt/cbt
git clone <URL-REPO> /opt/cbt
```

### Opsi B — Dari Windows `E:\Moodle` (repo ini belum berupa git)

Di PowerShell:

```powershell
cd E:\Moodle

tar --exclude=node_modules --exclude=.git --exclude=apps/api/uploads `
    --exclude=backups --exclude=.env --exclude=apps/api/.env `
    -czf cbt-src.tar.gz .

scp .\cbt-src.tar.gz cbtadmin@192.168.1.50:/tmp/

ssh cbtadmin@192.168.1.50 "sudo mkdir -p /opt/cbt && sudo tar -xzf /tmp/cbt-src.tar.gz -C /opt/cbt && sudo chown -R cbtadmin:cbtadmin /opt/cbt && rm /tmp/cbt-src.tar.gz"
```

Cek hasil:

```bash
ls -la /opt/cbt
ls /opt/cbt/deploy
```

File yang wajib ada: `docker-compose.prod.yml`, `deploy/env.production.example`,
`apps/api/Dockerfile`, `apps/web/Dockerfile`, `nginx/nginx.conf`.

> Jangan membawa `.env` / `apps/api/.env` dari development. Konfigurasi produksi
> dibuat terpisah di §7.

---

## 7. Konfigurasi produksi

```bash
cd /opt/cbt
cp deploy/env.production.example .env.production
chmod 600 .env.production

# Buat tiga nilai acak:
openssl rand -hex 24   # untuk POSTGRES_PASSWORD
openssl rand -hex 32   # untuk JWT_SECRET
openssl rand -hex 16   # untuk SEED_ADMIN_PASSWORD

nano .env.production
```

Isi minimal:

```dotenv
POSTGRES_USER=cbt
POSTGRES_DB=cbt
POSTGRES_PASSWORD=<hasil openssl rand -hex 24>
JWT_SECRET=<hasil openssl rand -hex 32>

CORS_ORIGIN=http://192.168.1.50
SEB_BROWSER_EXAM_KEY=

SEED_DEMO=false
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=<hasil openssl rand -hex 16>

WEB_BIND=0.0.0.0
WEB_PORT=80
TZ=Asia/Makassar
```

Aturan penting:

- `CORS_ORIGIN` harus **sama persis** dengan URL yang dibuka browser, termasuk
  skema dan port, tanpa garis miring di akhir.
  - Port 80: `http://192.168.1.50`
  - Port 8080: `http://192.168.1.50:8080`
  - HTTPS: `https://cbt.sekolah.sch.id`
- `POSTGRES_PASSWORD` sebaiknya **hex** (hanya `0-9a-f`) agar tidak perlu
  percent-encoding di `DATABASE_URL`. Jika memakai karakter khusus (`@ : / # ?`),
  password harus di-URL-encode.
- `JWT_SECRET` minimal 32 karakter acak. Jangan pakai nilai default dev.
- `SEB_BROWSER_EXAM_KEY` diisi Browser Exam Key asli dari file `.seb` bila sekolah
  memakai Safe Exam Browser. Kosong = sesi wajib SEB ditolak `503` (fail-closed).
  Beberapa key dipisahkan koma. Bila sekolah memakai **APK SEB Android**
  (BYOD, sideload), isi key yang sama dengan yang dimasukkan operator di
  perangkat; lihat `docs/SEB-ANDROID.md` (distribusi, rotasi, fingerprint).
- Password Postgres hanya dipakai saat volume database **pertama kali** dibuat.
  Mengubahnya setelah ada data tidak otomatis mengubah password di database
  (lihat §13.1).
- Produksi memakai `SEED_DEMO=false`: **tidak ada akun guru/proktor/siswa contoh**.
  Saat database masih kosong, seed hanya membuat satu admin dari
  `SEED_ADMIN_USERNAME` + `SEED_ADMIN_PASSWORD`. Seed tidak menimpa password
  atau konfigurasi yang sudah diubah admin.
- Jangan memakai `SEED_DEMO=true` di server produksi. Opsi itu hanya untuk VM
  latihan/demo karena membuat akun dengan password yang diketahui publik.

Validasi konfigurasi Compose tanpa menyalakan container:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production config >/dev/null
echo "config OK"
```

---

## 8. Deploy

```bash
cd /opt/cbt

docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# Tunggu 1–5 menit (build pertama lebih lama)
docker compose -f docker-compose.prod.yml --env-file .env.production ps

# Pantau migrasi + seed + API
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api
```

Saat container `api` start, otomatis:

1. `prisma migrate deploy`
2. `prisma seed` (idempoten)
3. `node dist/main.js`

Tunggu sampai `postgres`, `redis`, `api`, dan `web` berstatus **healthy/running**.
Ctrl+C hanya menghentikan tampilan log, bukan container.

Cek dari dalam VM:

```bash
curl -fsS http://127.0.0.1/api/health
curl -I http://127.0.0.1/
```

Buka dari komputer lain di LAN:

```text
http://192.168.1.50/
```

---

## 9. Verifikasi dan akun awal

Login pertama memakai:

- Username: nilai `SEED_ADMIN_USERNAME` (default `admin`)
- Password: nilai `SEED_ADMIN_PASSWORD` yang Anda isi di `.env.production`

Tidak ada akun guru/proktor/siswa bawaan. Setelah login:

1. Menu **Akun** → ganti password admin (password env hanya untuk
   bootstrap; seed tidak akan menimpanya setelah diganti).
2. Menu **Kelas & TA** dan **Mapel** → buat kelas/tahun ajaran dan mapel, lalu menu
   **Pengguna** → buat/import akun guru, proktor, dan siswa.
3. Login `guru` → buat satu soal + ujian + sesi percobaan.
4. Login `proktor` → aktifkan sesi, ambil token, cek monitoring.
5. Login siswa → kerjakan satu soal, submit, cek hasil setelah dipublish.
6. Bila memakai SEB: isi `SEB_BROWSER_EXAM_KEY`, restart `api`, lalu uji dari SEB
   asli atau dari **APK SEB Android** (lihat `docs/SEB-ANDROID.md`): operator
   mengatur Base URL + key di tiap HP, lalu lihat `sebVerified=true` di papan
   Monitoring proktor. Jangan menguji dengan header manual di browser.
7. Cek `/api/health` dan pastikan tidak ada error di `docker compose ... logs api`.

Untuk VM latihan/demo saja, Anda boleh set `SEED_DEMO=true` agar akun contoh
`admin`/`guru`/`proktor`/`0051234567` dibuat otomatis. Jangan lakukan ini di
server yang dipakai ujian sungguhan.

Jika volume database berasal dari development, akun demo lama **tidak dihapus**
oleh seed. Ganti password/nonaktifkan akun tersebut, atau mulai produksi dengan
volume database kosong.

---

## 10. Operasi harian

### 10.1 Perintah dasar

```bash
cd /opt/cbt
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"

$COMPOSE ps
$COMPOSE logs --tail=200 api
$COMPOSE logs -f web
$COMPOSE restart api
$COMPOSE restart web
$COMPOSE down          # stop, data tetap
```

**Jangan** menjalankan `down -v` di produksi: opsi itu menghapus volume database,
Redis, dan uploads.

### 10.2 Update aplikasi

```bash
cd /opt/cbt

# 1. Backup dulu
./deploy/backup.sh

# 2. Ambil source baru (git pull, atau kirim ulang tar seperti §6)
#    Contoh git:
# git pull --ff-only

# 3. Build ulang & rolling recreate
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d

# 4. Cek
docker compose -f docker-compose.prod.yml --env-file .env.production ps
docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=100 api

# 5. Bersihkan image lama (opsional)
docker image prune -f
```

Migrasi Prisma dijalankan otomatis saat `api` start. Tetap **backup sebelum update**
dan uji di VM lain bila perubahan skema besar.

### 10.3 Akses lewat SSH tunnel (tanpa membuka port web)

Jika port 80 tidak boleh dibuka ke jaringan, akses aplikasi lewat SSH:

```bash
ssh -L 8080:127.0.0.1:80 cbtadmin@192.168.1.50
```

Biarkan terminal terbuka, lalu buka:

```text
http://localhost:8080
```

Untuk deployment di belakang Caddy (`WEB_PORT=8080`), target tunnel adalah
`127.0.0.1:8080`:

```bash
ssh -L 8080:127.0.0.1:8080 cbtadmin@192.168.1.50
```

### 10.4 Backup

Script: `deploy/backup.sh` (dump PostgreSQL format custom + arsip uploads).

```bash
cd /opt/cbt
chmod +x deploy/backup.sh
./deploy/backup.sh
ls -lh backups/
```

Jadwalkan harian lewat cron user `cbtadmin` (buat folder log dulu):

```bash
mkdir -p /opt/cbt/backups
crontab -e
```

```cron
0 23 * * * cd /opt/cbt && ./deploy/backup.sh >> /opt/cbt/backups/backup.log 2>&1
```

Retensi default 14 hari (`RETENTION_DAYS=30 ./deploy/backup.sh` untuk mengubah).
Salin juga hasil backup ke **luar VM** (Proxmox Backup Server, NFS, atau `scp`).
Snapshot Proxmox bukan pengganti backup offsite.

### 10.5 Restore

Hentikan API/web dulu agar tidak ada koneksi/tulisan saat restore:

```bash
cd /opt/cbt
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"

$COMPOSE stop web api

# Restore database (format custom dari backup.sh)
$COMPOSE exec -T postgres sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' \
  < backups/cbt-YYYYMMDD-HHMMSS.dump

# Restore gambar soal ke volume uploads
$COMPOSE run --rm -T --no-deps --entrypoint sh api \
  -c 'tar xzf - -C /app/uploads' \
  < backups/uploads-YYYYMMDD-HHMMSS.tar.gz

$COMPOSE up -d
$COMPOSE ps
```

Uji prosedur restore ini minimal sekali sebelum ujian besar.

#### Uji coba backup & restore (15 Nov 2026 — di lingkungan dev Docker)

Prosedur yang sama dengan `deploy/backup.sh` dijalankan manual dan dibuktikan
dengan **restore ke database scratch** `cbt_drill` (bukan produksi; scratch
dihapus setelah uji):

```bash
# 1. Backup (sama dengan deploy/backup.sh)
docker exec cbt-postgres sh -c "pg_dump -U cbt -d cbt -Fc > /tmp/drill.dump"
docker cp cbt-postgres:/tmp/drill.dump backups/cbt-drill-<ts>.dump   # 661 KB
docker exec cbt-api sh -c "tar czf /tmp/uploads.tar.gz -C /app/uploads ."
docker cp cbt-api:/tmp/uploads.tar.gz backups/uploads-drill-<ts>.tar.gz  # 203 KB (10 berkas)

# 2. Restore ke scratch DB
docker exec cbt-postgres psql -U cbt -d postgres -c "CREATE DATABASE cbt_drill"
docker exec -i cbt-postgres pg_restore -U cbt -d cbt_drill --no-owner --no-privileges < backups/cbt-drill-<ts>.dump

# 3. Verifikasi jumlah baris IDENTIK (16 tabel, termasuk attempts/lockedAt):
#    schools 2, users 29, kelas 5, mapel 3, questions 1044, exams 24,
#    exam_questions 219, sessions 11, attempts 9, answers 38,
#    integrity_logs 4, token_audits 6, attendance 1, global_config 11, audit_logs 14905

# 4. Verifikasi arsip uploads bisa diekstrak (logo/stempel/branding + soal)

# 5. Bersih: DROP DATABASE cbt_drill; hapus berkas drill
```

Hasil: dump valid, **semua 15 tabel + kolom `lockedAt` terpulih persis sama**,
uploads terekstrak sempurna. Catatan penting: **jangan** pernah mengarahkan
`pg_dump`/`tar` langsung dengan `>` dari PowerShell — redirection PS menulis
file UTF-16 dan merusak arsip; selalu lakukan lewat `docker exec` + `docker cp`
(atau jalankan `./deploy/backup.sh` di Linux, yang memang aman).

---

## 11. HTTPS dengan domain (opsional)

Untuk LAN murni, `http://IP-VM` sudah cukup. Bila aplikasi diakses dari internet,
pakai HTTPS.

### 11.1 Arahkan domain dan port

1. Buat DNS `A` record, mis. `cbt.sekolah.sch.id` → IP publik sekolah.
2. Router: forward TCP 80 dan 443 ke `192.168.1.50`.
3. Ubah `.env.production`:

```dotenv
CORS_ORIGIN=https://cbt.sekolah.sch.id
WEB_BIND=127.0.0.1
WEB_PORT=8080
```

4. Recreate web:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d web
```

### 11.2 Pasang Caddy sebagai reverse proxy TLS

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Edit `/etc/caddy/Caddyfile`:

```caddyfile
cbt.sekolah.sch.id {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8080
}
```

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl status caddy
sudo ufw allow 443/tcp
```

Buka `https://cbt.sekolah.sch.id`. Caddy mengurus sertifikat Let's Encrypt otomatis.

Catatan:

- nginx sudah meneruskan `X-Forwarded-Proto` dari Caddy, jadi URL untuk hash SEB tetap
  `https://...` dan verifikasi SEB tidak gagal.
- Karena semua request melewati Caddy, throttle login per-IP akan melihat IP proxy.
  Batas **per username** tetap berlaku (5 gagal/5 menit). Untuk sekolah dengan satu
  gerbang internet, ini biasanya dapat diterima.
- Jangan membuka `WEB_BIND=0.0.0.0` bersamaan dengan Caddy; bind ke `127.0.0.1`.

---

## 12. Akses dari luar jaringan sekolah

| Kebutuhan | Cara aman |
| --- | --- |
| SSH dari rumah | **Tailscale/WireGuard VPN** ke LAN sekolah; hindari port-forward 22 terbuka ke internet |
| Aplikasi dari rumah | VPN yang sama, atau domain + HTTPS (Caddy) + firewall |
| Tanpa IP publik | Cloudflare Tunnel / Tailscale Serve |
| Darurat | SSH tunnel (§10.3) |

Jika terpaksa membuka SSH ke internet: key-only, `PermitRootLogin no`, `fail2ban`,
dan batasi user. Jangan pernah membuka PostgreSQL/Redis.

---

## 13. Troubleshooting

| Gejala | Penyebab umum | Solusi |
| --- | --- | --- |
| `ssh: connection refused` | SSH mati / IP salah / firewall | Cek di console: `systemctl status ssh`, `ip -br a`, `sudo ufw status`; cek firewall Proxmox |
| SSH password ditolak | Password login dimatikan | Pakai key; perbaiki via Proxmox Console |
| Web tidak terbuka dari PC lain | Port 80 tertutup / VM beda subnet | `ss -ltnp \| grep :80`, `ufw status`, ping VM, cek bridge Proxmox |
| `502 Bad Gateway` | API belum healthy / crash | `$COMPOSE logs --tail=200 api`; cek DB/Redis |
| API restart loop | Password DB salah / migrasi gagal / seed gagal | Log API; cocokkan `POSTGRES_PASSWORD` dengan volume lama (§13.1); pastikan `SEED_ADMIN_PASSWORD` terisi bila `SEED_DEMO=false` |
| Login `429` | Terlalu banyak password salah | Tunggu `LOGIN_WINDOW_SEC` (default 300 detik) |
| SEB `503` | `SEB_BROWSER_EXAM_KEY` kosong | Isi key, `$COMPOSE up -d api` |
| SEB `400` | URL/hash tidak cocok | Pastikan skema (http/https), host, dan port sama dengan yang dibuka SEB; di belakang Caddy cek `X-Forwarded-Proto`. Untuk APK Android: base URL harus sama persis dengan yang dikonfigurasi operator (tanpa slash akhir), dan Browser Exam Key harus sama dengan server (bandingkan sidik jari 8 hex, lihat `docs/SEB-ANDROID.md`) |
| Upload 404 setelah redeploy | Volume uploads hilang | Jangan `down -v`; cek `docker volume ls` |
| Waktu di PDF/Excel salah | Timezone container | Pastikan `TZ=Asia/Makassar` dan image API memuat `tzdata` (sudah ada di Dockerfile) |
| `permission denied` Docker | User belum masuk grup docker | `sudo usermod -aG docker cbtadmin`, logout/login |
| Halaman kosong setelah update | Cache HTML lama | Hard refresh (Ctrl+F5); `index.html` sudah `no-cache` |
| CORS error | `CORS_ORIGIN` tidak sama | Samakan skema/host/port, tanpa trailing slash |
| Disk penuh | Image/log/backup | `df -h`, `docker system df`, `docker image prune -f`, hapus backup lama |
| Port 80 sudah dipakai | Apache/nginx host | `sudo ss -ltnp \| grep :80`; set `WEB_PORT=8080` dan sesuaikan `CORS_ORIGIN` |

### 13.1 Mengganti password database setelah volume dibuat

Mengubah `POSTGRES_PASSWORD` di `.env.production` **tidak** mengubah password di
database yang sudah ada. Pilih salah satu:

```bash
# Opsi A — ubah password user di database (data tetap)
$COMPOSE exec postgres psql -U cbt -d cbt -c "ALTER USER cbt WITH PASSWORD 'PASSWORD_BARU';"
# lalu ubah POSTGRES_PASSWORD di .env.production dan recreate api:
$COMPOSE up -d api
```

Opsi B — hapus volume database (**SEMUA DATA HILANG**), hanya untuk instalasi baru:

```bash
$COMPOSE down
docker volume rm cbt-prod_pgdata
$COMPOSE up -d
```

---

## 14. Checklist sebelum ujian

- [ ] `timedatectl` menunjukkan WITA dan NTP sinkron.
- [ ] `docker compose ... ps` semua sehat; `/api/health` OK.
- [ ] Password admin sudah diganti; tidak ada akun demo/default aktif.
- [ ] `SEB_BROWSER_EXAM_KEY` benar (bila memakai SEB).
- [ ] Uji login 4 role + satu attempt siswa sampai submit.
- [ ] Backup terbaru ada dan disalin ke luar VM.
- [ ] Disk > 20% kosong; `docker system df` wajar.
- [ ] UFW hanya 22 + 80/443; 5432/6379 tertutup.
- [ ] HTTPS aktif bila diakses dari internet.
- [ ] Proxmox UI tidak diekspos ke internet; akses admin lewat VPN.
- [ ] UPS/backup daya untuk server dan switch lab.
- [ ] Rencana rollback: snapshot VM + backup DB sebelum perubahan besar.

---

## 15. Lampiran — urutan perintah ringkas

```bash
# Di VM (setelah Ubuntu + Docker siap)
sudo mkdir -p /opt/cbt && sudo chown "$USER":"$USER" /opt/cbt
# ...kirim source ke /opt/cbt (§6)...

cd /opt/cbt
cp deploy/env.production.example .env.production
chmod 600 .env.production
openssl rand -hex 24   # POSTGRES_PASSWORD
openssl rand -hex 32   # JWT_SECRET
nano .env.production

docker compose -f docker-compose.prod.yml --env-file .env.production config >/dev/null
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production ps
curl -fsS http://127.0.0.1/api/health

chmod +x deploy/backup.sh
./deploy/backup.sh
```
