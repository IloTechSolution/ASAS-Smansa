# Panduan Operator — CBT SMAN 1 Gorontalo

Panduan ringkas harian untuk operator/proktor sekolah (non-teknis). Detail lengkap: `docs/DEPLOYMENT.md` (server/backup), `docs/SEB-ANDROID.md` (APK), `docs/API.md` (kontrak API).

## Peran di aplikasi

| Peran | Bisa melakukan |
|---|---|
| **ADMIN** | Master data (pengguna/kelas/mapel), Pengaturan, audit log, lintas sekolah (SMAN 1 & 8), backup |
| **GURU** | Bank soal, ujian, sesi & nilai (milik sendiri atau ujian dari admin), KKM per mapel |
| **PROKTOR** | Sesi & token TOTP, absensi, monitoring live, kartu, pelanggaran, remedial |
| **SISWA** | Mengerjakan ujian (login NISN + password) |

## H−1 — Sehari sebelum ujian

1. **ADMIN → Pengaturan**: nama sekolah, tahun ajaran, KKM default, "Wajib SEB" default, **interval token default** (hanya di sini — pengaturan interval per sesi ada di tab Token).
2. **ADMIN → Siswa** (menu Data Master → Siswa): import siswa dari Excel (tombol **Template** → isi → **Import**; kolom: **NISN | Nama | Password | Kelas | Ruang**). NISN = username. Kelas yang belum ada dibuat otomatis (tahun ajaran dari Konfigurasi); kolom **Ruang** opsional — langsung mengatur/memperbarui Ruang Ujian kelas (impor ulang file yang sama hanya untuk memperbarui ruang — baris duplikat tidak dibuat ulang). Ruang ujian tercetak di Kartu Login peserta. Untuk membuat akun siswa baru lewat UI, isi kolom **NISN**.
3. **GURU**: buat/cek soal di bank soal → buat **Ujian** → buat **Sesi** (jadwal mulai–selesai, durasi, kelas peserta, interval token, wajib SEB bila perlu).
4. **PROKTOR**: buka panel sesi → tab **Pengaturan** untuk hari pelaksanaan (Hari 1–5 / Senin–Jumat) & kelas peserta; tab **Enrol** bila perlu; cetak **Kartu Peserta**; **Absensi** (lembar tanda tangan).
5. **Backup**: `./deploy/backup.sh` (lihat `docs/DEPLOYMENT.md` §10.4).

## H−0 — Hari ujian

1. **PROKTOR → Sesi & Token**: pilih sesi → buka panel pelaksanaan → tombol **Tampilkan ke Siswa** (kanan atas). Ujian langsung muncul di "Ujian Saya" siswa. Dialog akan menanyakan apakah token dirilis sekarang — klik **Rilis token sekarang** (atau nanti di tab **Token**; tombol Rilis Token hanya aktif selama sesi tampil).
2. Siswa login (NISN + password) dari **APK** (sesi wajib SEB) atau browser (sesi tanpa SEB).
3. **PROKTOR**: tab **Token** proyeksikan/bagikan 6 digit token (bergilir otomatis; interval diatur di tab Token — bukan lagi di Pengaturan).
4. Pantau **Siswa Online** (menu samping → *Siswa Online*) dan **Monitoring Live** — siswa yang online terbaca otomatis.
5. Setelah selesai: **Absensi PDF** → **Monitoring Pelanggaran** (siapa melanggar apa).

> Tidak ada lagi alur Draf/Terjadwal/Aktif. Ujian tampil = tampil ke siswa, satu tombol.
> Mengedit pengaturan hanya bisa **selama tersembunyi**; saat tampil hanya interval token yang bisa diubah (di tab Token). Tombol darurat **Tutup & Kumpul Paksa** ada di pengaturan pelaksanaan.

## Saat ujian — situasi khusus

| Masalah | Tindakan |
|---|---|
| Siswa **terkunci** (batas pelanggaran terlampaui) | Siswa keluar ke halaman login. Beri **token 6 digit terbaru**. Siswa login lagi → daftar ujian → tombol **TERKUNCI — minta token proktor** → masukkan token → ujian dilanjutkan, jawaban aman. |
| Siswa **lupa password** | ADMIN → Pengguna → tombol reset password. |
| Siswa membuka dari **browser biasa** (sesi wajib SEB) | Pastikan siswa membuka **APK**; cek key di HP: mode operator → **Uji key ke server** (harus "Key cocok ✓"). |
| Siswa **curang / keluar layar** | Peringatkan (tombol Peringat), tambah waktu bila perlu, atau **Kumpulkan Paksa**. |
| **Jaringan lab bermasalah** | Jawaban autosave tersimpan; saat online kembali siswa lanjut. Siswa bisa ketuk tombol **Refresh** (kanan bawah). |
| Siswa ingin **menutup APK** | Tombol merah (kiri bawah) — butuh **PIN keluar** yang diatur admin (Pengaturan web). |

## Setelah ujian

1. Semua peserta selesai (atau waktu habis → otomatis EXPIRED).
2. **GURU → Nilai**: klik **Nilai Ulang** bila perlu, lalu **Terbitkan Hasil** (aktif bila semua peserta selesai).
3. Export Excel / sertifikat PDF / kartu / absensi (endpoint sertifikat PDF tetap tersedia untuk guru pemilik ujian).
4. **PROKTOR → Monitoring Pelanggaran** untuk rekap siapa melanggar apa.

## APK kiosk — mode operator

- Buka dengan **7× ketukan sudut kiri atas** **atau** **tahan tombol Refresh biru ±2 detik**.
- **PIN operator** bawaan: `sman1gorontalo2026` (dapat diganti saat build: `--dart-define=OPERATOR_PIN=...`).
- Menu: Base URL server → **Set/ganti Browser Exam Key** → **Uji key ke server** → kunci layar → **Keluar aplikasi** (PIN keluar dari admin).
- **Browser Exam Key** server: `.env` → `SEB_BROWSER_EXAM_KEY` (bawaan `CBTSMAN1GORONTALO2026`) — **bukan rahasia tingkat tinggi**, tapi jangan sebar; ganti lewat `.env` + `docker compose up -d api` + isi ulang key di semua HP (lihat `docs/SEB-ANDROID.md` §7).

## Backup & restore (wajib dipahami)

- Backup harian otomatis lewat cron (lihat `docs/DEPLOYMENT.md` §10.4).
- **Salin hasil backup ke luar VM** (Proxmox Backup Server/NFS/USB) — backup di VM yang sama bukan backup aman.
- Uji restore **minimal sekali sebelum ujian besar** — prosedur lengkap + hasil uji coba 15 Nov 2026 di `docs/DEPLOYMENT.md` §10.5 ("Uji coba backup & restore").

## Kalau semuanya gagal

1. Lihat `docs/DEPLOYMENT.md` §13 (Troubleshooting) — password DB, restore, log container.
2. Restart service: `docker compose restart api web`.
3. Pastikan HP & server satu jaringan; APK butuh koneksi **saat ujian** (untuk mulai) — autosave jalan saat online.
