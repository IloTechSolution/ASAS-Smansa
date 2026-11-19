# Deploy CBT SMAN 1 Gorontalo ke Proxmox (dari VDI)

Image ini berisi **Ubuntu Server 24.04.5 + Docker + stack CBT lengkap (kode 16 Nov 2026 (NestJS 11)) + data demo SMAN 1 & SMAN 8**.
Login pertama hanya untuk pengujian — untuk produksi, ikuti langkah hardening di bawah.

## 1. Isi image

| Item | Nilai |
|---|---|
| File | `deploy/vm/CBT-SMAN1-Gorontalo.vdi` (10,9 GB, disk dinamis) |
| SHA-256 | `79138B85E5BCD601AD590CD187DE62D5CE80B776C8F65C5D77FA6875B4F9C600` |
| Guest OS | Ubuntu Server 24.04.5 (64-bit) |
| Sumber | Ubuntu ISO 24.04.5 + stack CBT |
| Kode di dalam image | snapshot repo 16 Nov 2026 — **NestJS 11.2.10, ESM shared (vendor web 176 kB), indeks `Attempt(sessionId,status)`** — suite verify 664/664 PASS |
| Port aplikasi | 8080 (web + API lewat nginx), SSH 22 |
| Data demo | ya (SMAN 1 & SMAN 8, `SEED_DEMO=true`) |

Akun (samakan dengan `deploy/vm/README.txt`):

| Role | SMAN 1 | SMAN 8 |
|---|---|---|
| Admin | `admin` / `Admin123!` | — |
| Guru | `guru` / `Guru123!` | `guru8` / `Guru123!` |
| Proktor | `proktor` / `Proktor123!` | `proktor8` / `Proktor123!` |
| Siswa | `0051234567` / `Siswa123!` | `0081234567` / `Siswa123!` |

SSH ke VM: user `cbt`, password `cbt2026!` (user cbt anggota grup `docker`).

## 2. Konversi VDI → qcow2 (di host Proxmox)

Proxmox tidak memakai format VDI secara native — konversi sekali di host (qemu-img sudah tersedia):

```bash
# unggah VDI ke host (dari PC Windows, atau scp)
scp CBT-SMAN1-Gorontalo.vdi root@<IP-PROXMOX>:/var/tmp/

# konversi
qemu-img convert -p -f vdi -O qcow2 /var/tmp/CBT-SMAN1-Gorontalo.vdi /var/tmp/cbt-sman1.qcow2
```

Alternatif tanpa konversi: `qm importdisk` juga menerima VHD/qcow2/raw; bila prefer langsung,
pakai file `deploy/vm/vbox/cbt-test.vhd` (isi sama sebelum update 16 Nov 2026 — **gunakan VDI**,
itu yang sudah berisi kode terbaru).

## 3. Buat VM di Proxmox

Via CLI (ganti `<storage>` dengan storage VM Anda, mis. `local-lvm`):

```bash
qm create 200 --name cbt-sman1 --memory 4096 --cores 2 \
  --net0 virtio,bridge=vmbr0 --scsihw virtio-scsi-single --ostype l26 \
  --boot order=scsi0
qm disk import 200 /var/tmp/cbt-sman1.qcow2 <storage>
qm set 200 --scsi0 <storage>:vm-200-disk-0,ssd=1,discard=on
qm resize 200 scsi0 40G          # disk image 25 GB terisi ±12 GB; 40 GB nyaman
qm set 200 --boot order=scsi0
qm start 200
```

Via GUI: Create VM → General (nama `cbt-sman1`) → OS: Linux, 6.x - 2.6 Kernel →
Disk: 40 GB, scsi0, discard on → Memory 4096 MB, 2 CPU (4 lebih baik untuk ujian 200+ siswa) →
Network: bridge vmbr0, model VirtIO → Finish → Hardware → harddisk → Disk Action → Import Disk →
pilih `cbt-sman1.qcow2` → set boot order scsi0 → Start.

## 4. Akses aplikasi

Tunggu 1–2 menit (Docker auto-start). Lalu buka:

```
http://<IP-VM>:8080
```

Cek kesehatan API: `http://<IP-VM>:8080/api/health` → `{"status":"ok","db":"ok","redis":"ok"}`.

Cari IP VM (di konsol Proxmox → `ip a`, atau cek DHCP lease di router).

## 5. Produksi (WAJIB setelah ujian wisuda/demo)

1. **Ganti semua password demo** di web (admin → Pengguna) + password VM (`passwd cbt`).
2. **SEB**: isi `SEB_BROWSER_EXAM_KEY` di `/opt/cbt/.env` sesuai key di APK SEB, lalu
   `cd /opt/cbt && sudo docker compose -f docker-compose.yml up -d`.
3. **Matikan data demo** bila tidak diinginkan: edit `/opt/cbt/.env` → `SEED_DEMO=false`,
   hapus akun demo dari web (Pengguna → Hapus) atau hapus database dan seed ulang dengan `SEED_DEMO=false`.
4. **Backup harian** (sudah ada skrip): `cd /opt/cbt && sudo ./deploy/backup.sh`,
   jadwalkan cron: `0 23 * * * cd /opt/cbt && ./deploy/backup.sh >> /var/log/cbt-backup.log 2>&1`.
   **Selalu salin backup ke luar VM** (PBS/NFS/storage lain).
5. **Mode produksi penuh** (opsional, direkomendasikan): stack prod = web di port 80, DB/Redis
   tidak terekspos, log JSON dibatasi, `SEED_DEMO=false`:
   ```bash
   cd /opt/cbt
   sudo cp .env .env.production
   # edit .env.production: JWT_SECRET & POSTGRES_PASSWORD & SEED_ADMIN_PASSWORD (acak),
   # SEED_DEMO=false, WEB_URL=http://<IP-VM>, CORS_ORIGIN=http://<IP-VM>, WEB_PORT=80
   sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
   ```
   Perhatian: mengganti ke prod compose memakai volume baru (`cbt-prod_pgdata`). Untuk memindahkan
   data demo: `docker compose -f docker-compose.yml exec -T postgres pg_dump -U cbt -d cbt -Fc > /tmp/cbt.dump`
   lalu restore ke volume prod (`pg_restore`) — verifikasi dulu di mesin uji.
6. **HTTPS**: untuk akses di luar lab, pasang Caddy/Nginx + sertifikat (lihat `docs/DEPLOYMENT.md`).
   Aplikasi tetap aman di HTTP LAN lab (WebView SEB & cookie tidak dipakai lintas situs).

## 6. Update aplikasi di dalam VM (cara yang sama dipakai saat membuat image ini)

```bash
# di PC: tar -czf cbt-src.tar.gz --exclude=node_modules --exclude=dist --exclude=deploy/vm .
scp cbt-src.tar.gz cbt@<IP-VM>:/home/cbt/
# di VM:
cd /opt/cbt && sudo docker compose -f docker-compose.yml down
sudo mv /opt/cbt /opt/cbt.old && sudo mkdir /opt/cbt
sudo tar -xzf /home/cbt/cbt-src.tar.gz -C /opt/cbt
sudo cp /opt/cbt.old/.env /opt/cbt/.env     # .env (secrets) tidak ikut tarball
cd /opt/cbt && sudo docker compose -f docker-compose.yml build && sudo docker compose up -d
curl http://localhost:8080/api/health
```

## 7. Troubleshooting

- **VM tidak menyala / boot lama**: cek di Proxmox Console; disk image `scsi0` harus bootable.
- **8080 tidak bisa diakses**: `ip a` → pastikan IP benar; firewall VM: `sudo ufw status` (default nonaktif di image ini).
- **Health `db: down`**: `sudo docker compose -f /opt/cbt/docker-compose.yml logs postgres` — tunggu sampai healthy, lalu `sudo docker compose start`.
- **Login admin ditolak**: akun seed ada; bila password lupa/hilang, rebuild VM dari VDI ini
  (data kembali ke kondisi demo), atau reset hash di database lewat akun admin lain / konsol `psql`
  (`docker compose exec postgres psql -U cbt -d cbt`).
- **Reset total ke data demo**: hapus volume `pgdata`/`redisdata`/`uploads` di `/opt/cbt` lalu `docker compose up -d`, atau buat VM baru dari VDI yang sama.
