# SEB SMAN 1 Gorontalo — Android (APK Safe Exam Browser kustom)

> **Ganti nama (v2.0.0):** aplikasi kini tampil sebagai **"SEB SMAN 1 Gorontalo"**
> (bukan lagi "SEB CBT SMAN 1 Gorontalo"). Package ID tetap
> `id.sch.sman1gorontalo.seb` dan sertifikat sama — pasang v2.0.0 **di atas** v1.x,
> konfigurasi operator (Base URL, Browser Exam Key) tersimpan. APK web app CBT
> tetap bernama "CBT SMAN 1 Gorontalo" — hanya APK yang berganti nama.

APK kiosk **"SEB SMAN 1 Gorontalo"** (`id.sch.sman1gorontalo.seb`) — klien
Safe Exam Browser buatan sendiri berbasis WebView, dipakai untuk ujian
(BYOD, sideload, tanpa Play Store). APK ini **bukan** Safe Exam Browser resmi
proyek upstream (resmi hanya Windows/macOS/iOS); ia mengimplementasikan skema
verifikasi yang sama
(`X-SafeExamBrowser-RequestHash` = `SHA256(URL absolut + Browser Exam Key)`)
sehingga server CBT memverifikasinya persis seperti SEB desktop.

> Status: **v2.1.1** — `dist-seb/SEB-SMAN1-Gorontalo-v2.1.1.apk` (ARM universal,
> SHA-256 `EB42BA7FE198086A1CE2B399E149DC56BA042891C2D2155A1ED9E620A0475A50`, 32.3 MB).
> Varian: `SEB-SMAN1-Gorontalo-v2.1.1-arm64-v8a.apk` (18.2 MB,
> SHA-256 `35618BD878B7B5C653F4EF77DF9A4C2B0247A9CA1B140F9ABF60B118396C908F`) dan
> `SEB-SMAN1-Gorontalo-v2.1.1-armeabi-v7a.apk` (15.7 MB,
> SHA-256 `D2A1D343C250915F8FAD44F46BD6D4C7ECB9F57481D9DEDEB264D073E2C94E6D`).
> **Baru di v2.1.1:** mode operator kini bisa dibuka 2 cara — ketuk **7× sudut
> kiri atas** (jeda diperlonggar 1,5 dtk) atau **tahan tombol Refresh biru ±2
> detik**. **v2.1.0:** APK bisa dibuka via **HTTP di jaringan lab**
> (`http://192.168.x.x:8080`), **tombol Keluar (ikon power) selalu terlihat**,
> layar error jaringan ditulis ulang, splash minimal tampil. **v2.0.0:** nama
> app baru, tombol Keluar wajib PIN admin, minSdk Android 10. Lihat Changelog
> §10. `flutter analyze` 0 issue, `flutter test` 10/10.
> v2.1.0, v2.0.0, v1.x & lama tetap tersedia di `dist-seb/`.

---

## 1. Arsitektur singkat

```
[HP siswa] WebView ──▶ https://<host server CBT>
   │                         │
   │ SebBridge (JS)          │ /api/attempts/* (wajib header SEB bila sesi requireSeb)
   ▼                         ▼
SHA256(URL+BrowserExamKey)  Origin check + timingSafeEqual (lihat apps/api/src/attempts/seb.ts)
```

- Browser biasa **tidak** bisa lolos sesi `requireSeb=true` (tidak ada hash) — 400.
- APK menghitung hash di **native** (key tersimpan terenkripsi di
  FlutterSecureStorage, tidak pernah ditampilkan ke JS/logs/UI).
- Server merekonstruksi URL yang di-hash dari `X-Forwarded-Proto`/`X-Forwarded-Host`
  (nginx meneruskan keduanya) + `originalUrl`. **Wajib HTTPS di produksi** (Caddy).
- Key server: env `SEB_BROWSER_EXAM_KEY` (boleh beberapa, dipisah koma).
  Kosong + sesi wajib SEB → `503` (fail-closed).
- Sesi boleh wajib atau tidak: centang "Wajib SEB" per sesi, atau admin set
  default per sekolah (`REQUIRE_SEB_DEFAULT` di Pengaturan).

## 2. Distribusi (sideload, tanpa Play Store)

File installer (Android 10+) — versi terbaru **v2.1.2** (16 Nov 2026):

| Berkas | Ukuran | Cocok untuk | SHA-256 |
|---|---|---|---|
| **`dist-seb/SEB-SMAN1-Gorontalo-v2.1.2.apk`** | 50.2 MB | **Rekomendasi default** — semua HP (termasuk x86_64) | `2C86C88CE3C0B3FBFB6AAA459B71DA2EF9584B637314D67C8075CC7A0938D54B` |
| `dist-seb/SEB-SMAN1-Gorontalo-v2.1.2-arm64-v8a.apk` | 18.2 MB | HP 64-bit (hampir semua Android 10+) — **paling ringan** | `F623E738A8306D2169C749EEFAD904F7ECAF1C95D1E20BA47939FFB26ADE8B8B` |
| `dist-seb/SEB-SMAN1-Gorontalo-v2.1.2-armeabi-v7a.apk` | 15.7 MB | HP 32-bit lama yang masih Android 10 | `A3D094B0C54FE47ED10D6643FC473E6949C09DA3F72B8408F9A96CE3FC9F5A12` |
| `dist-seb/SEB-SMAN1-Gorontalo-v2.1.2-x86_64.apk` | 19.6 MB | Emulator/tablet x86_64 | `AFADE73475126DA0E95D67E0E818C03DCD53F3B2F23EAC43A743B2DFE3F30B53` |

v2.1.1 dan sebelumnya dipertahankan di `dist-seb/` sebagai arsip.


Pemasangan di tiap HP siswa/operator:

1. Kirim APK (USB / link unduhan / Google Drive sekolah).
2. HP → **Setelan → Aplikasi → Izin khusus → Pasang aplikasi tidak dikenal** →
   izinkan sumber (File Manager/Chrome).
3. Buka file APK → **Pasang** → **Buka** → layar **Konfigurasi operator** tampil.

> **Update dari v1.x:** pasang v2.0.0 **langsung di atas** v1.x (package ID &
> sertifikat sama) — konfigurasi operator tidak hilang. Uninstall hanya bila
> harus, karena menghapus konfigurasi tersimpan.

## 3. Konfigurasi operator (wajib sekali per HP)

**First-run (layar Konfigurasi operator):**

| Field | Isi |
|---|---|
| Base URL server CBT | URL publik persis yang akan dibuka siswa, mis. `https://cbt.sekolah.sch.id` (tanpa slash akhir; path boleh bila app dipasang sub-path) |
| Browser Exam Key (opsional) | Sama persis dengan `SEB_BROWSER_EXAM_KEY` di server. Layar pertama menampilkan **sidik jari 8 hex** key yang Anda ketik — samakan dengan server. Kosongkan hanya bila yakin tidak ada sesi wajib SEB. |

> **Penting (v1.1.0):** bila key kosong / salah, sesi **wajib SEB tidak bisa dikerjakan** di perangkat itu (`400`). Kolom key menampilkan sidik jari saat Anda mengetik — cocokkan dulu sebelum menekan SIMPAN.

**Setelah terpasang (mode operator, tersembunyi)** — ada **2 cara** membuka:

1. Ketuk **7×** pada sudut kiri-atas layar (area tak terlihat 72×72, jeda maks 1,5 dtk), **atau**
2. **Tahan tombol Refresh biru** di kanan bawah **±2 detik**.
3. Masukkan **PIN operator** (bawaan: `sman1gorontalo2026`).

> **JANGAN TERTUKAR** — ada 3 "PIN/key" berbeda di aplikasi ini:
>
> | Nama | Fungsi | Bawaan | Diatur oleh |
> |---|---|---|---|
> | **PIN operator** | Buka menu operator (untuk ganti Base URL / key) | `sman1gorontalo2026` | operator (ganti saat build via `--dart-define=OPERATOR_PIN=...`) |
> | **Browser Exam Key** | Verifikasi SEB ke server (soal wajib SEB) | `CBTSMAN1GORONTALO2026` (v2.1.x) | admin via `.env` server (`SEB_BROWSER_EXAM_KEY`) |
> | **PIN keluar** | Menutup aplikasi | (belum diatur) | admin via web → Pengaturan → "PIN Keluar APK SEB" |
>
> Kesalahan paling umum: memasukkan SEB key ke dialog "PIN operator" (atau
> sebaliknya) — keduanya berbeda dan tidak bisa saling menggantikan.

**Menu operator (ganti exam key di sini):**
   - **Base URL server** — ubah bila pindah server/domain.
   - **Set/ganti Browser Exam Key** — key disimpan terenkripsi; hanya
     **sidik jari 8 hex** (`sha256(key)[:8]`) yang ditampilkan.
   - **Uji key ke server** — verifikasi sekali ketuk **tanpa login**:
     menampilkan hasil **Key cocok ✓ / Key TIDAK cocok / Server belum siap**
     beserta sidik jari perangkat dan server (tool ini memanggil
     `GET /api/seb/self-test` dengan hash key perangkat).
   - **Kunci layar (screen pinning)** — aktif by default. Home/Recents/
     notifikasi terkunci sampai siswa melepas pin (tahan Recents + Kembali,
     dan PIN layar bila perangkat disetel). Pertama kali OS menampilkan
     dialog "App is pinned" — siswa harus ketuk **Got it**.
   - **Hapus Browser Exam Key** — sesi wajib SEB di perangkat ini akan gagal `400`.
   - **Keluar aplikasi** — menutup aplikasi. **Wajib PIN keluar yang diatur
     admin** (lihat di bawah). Tombol back sistem dan tombol Home tetap
     tidak bisa dipakai untuk keluar tanpa PIN.

> **Tombol Keluar selalu terlihat**: ikon power merah mengambang di
> **kiri bawah layar** (sebelahan dengan tombol Refresh biru di kanan
> bawah) — ketuk kapan pun (bahkan saat error/offline) → dialog **PIN
> keluar** tampil langsung.

**Mengatur PIN keluar (ADMIN, sekali saja):**

1. Web CBT → login sebagai ADMIN → **Pengaturan**.
2. Kartu **"PIN Keluar APK SEB"** → isi **PIN baru (4–8 angka)** → **Simpan PIN**.
3. Status berubah menjadi "Sudah diatur · <tanggal>". PIN disimpan sebagai
   hash SHA-256 di server (per sekolah) — admin tidak bisa melihat PIN yang
   tersimpan, hanya mengganti atau menghapusnya.
4. Semua HP sekolah langsung bisa memakai PIN itu untuk "Keluar aplikasi"
   (tanpa update APK).
5. **Hapus PIN** → tombol keluar dinonaktifkan total (tidak bisa keluar dari
   APK sampai PIN diatur lagi).

Sifat verifikasi PIN:

- Diverifikasi **ke server** (`POST /api/seb/exit-verify`) — butuh koneksi
  internet **saat menutup aplikasi**. Tanpa jaringan, APK menolak keluar
  (fail-closed) dan menampilkan penjelasan.
- Salah **10 kali dalam 5 menit** dari sekolah+IP yang sama → `429`
  ("Terlalu banyak percobaan") — mencegah tebak-tebakan.
- PIN salah → aplikasi tetap terbuka. PIN belum diatur admin → aplikasi
  tetap terbuka (tombol keluar nonaktif).
- PIN keluar **diverifikasi ke sekolah** (default `sman1`; multi-sekolah:
  kirim `{"school":"slug"}` — APK memakai default sekolah server).
- Keluar disengaja tidak memicu alarm pelanggaran atau catatan `WINDOW_BLUR`
  (alarm hanya untuk meninggalkan aplikasi tanpa izin).

**Mencocokkan key dengan server:** sidik jari 8 hex di perangkat harus sama
dengan `sha256(key_server)[:8]`. Cek di server:
`printf '%s' "$SEB_BROWSER_EXAM_KEY" | sha256sum` (ambil 8 hex pertama).
Cara paling mudah: mode operator → **Uji key ke server** — selesai dalam 1 ketuk.

## 4. Perilaku kiosk & keterbatasan BYOD (penting!)

**Yang dilakukan APK:**

- Layar penuh immersive (status/navigation bar disembunyikan).
- **Kunci layar (screen pinning)** — saat layar kiosk aktif, perangkat dipin:
  Home/Recents/notifikasi terkunci untuk siswa. Lepas pin hanya dengan
  gerakan OS (tahan Recents + Kembali; plus PIN layar bila perangkat
  disetel — **disarankan semua HP sekolah terpasang PIN/pola**).
- **Screenshot & thumbnail Recent Apps diblokir** (`FLAG_SECURE`; aplikasi
  juga **disembunyikan dari daftar Recent Apps**).
- **Layar tetap menyala** selama aplikasi terbuka (`FLAG_KEEP_SCREEN_ON`).
- **Tombol back diblokir** — back hanya menutup keyboard; siswa tidak bisa
  menutup aplikasi lewat back. Satu-satunya jalan keluar:
  mode operator (7 ketukan + PIN operator) → **Keluar aplikasi** → **PIN
  dari admin sekolah** (verifikasi ke server; lihat §3).
- **Backup aplikasi dimatikan** (`allowBackup=false`) — token sesi terenkripsi
  tidak dibackup ke Google Drive dan tidak pulih saat reinstall; membuka
  aplikasi setelah install selalu berakhir di halaman login.
- **Aplikasi tidak bisa dibagi layar / freeform** (`resizeableActivity=false`)
  dan terkunci potret — ruang ujian selalu penuh.
- **Hanya origin server CBT yang bisa dibuka** — link eksternal/`target=_blank`
 /`window.open` ditolak (toast "Hanya aplikasi CBT resmi yang diizinkan.").
- **TLS wajib valid** — error sertifikat ditolak (tidak ada bypass).
- **Keluar aplikasi (Home/Recents/power) → alarm pelanggaran berbunyi**
  (ringtone alarm di stream ALARM — tidak bisa dimatikan tombol volume/senyap;
  plus getar) dan dicatat sebagai `WINDOW_BLUR` (sumber `apphidden`) →
  mengikuti alur `maxViolations` (auto **Kumpul paksa** bila melewati batas).
- **Keluar aplikasi → membuka lagi → wajib login ulang** — token sesi web
  dihapus saat aplikasi ditinggalkan/dibunuh; membuka aplikasi selalu
  berakhir di halaman login.
- **Semua pelanggaran lain (pindah tab, keluar fullscreen, copy/tempel)
  juga membunyikan alarm** — alarm dipicu dari web lewat `SebBridge.alarm`.
- **Tombol Refresh biru** mengambang di kanan bawah (di setiap halaman) —
  memuat ulang halaman saat koneksi tersangkut.
- Tidak ada izin kamera/storage/lokasi — hanya `INTERNET` + `VIBRATE`.
- Lalu lintas **cleartext (http) ditolak** di build release; hanya HTTPS.

**Yang TIDAK bisa diblokir di HP pribadi siswa (BYOD):**

- Siswa tetap bisa **melepas pin** dengan gerakan OS (Recents + Kembali). Bila
  perangkat disetel PIN/pola, gerakan ini membutuhkan PIN — karena itu
  **HP sekolah wajib disetel PIN/pola**. Lepas pin bukan berarti bebas:
  pelanggaran tetap tercatat di server dan saat membuka kembali, siswa
  **wajib login ulang**.
- Perangkat lain (HP kedua, buku) di luar jangkauan software.

**Kebijakan yang disarankan:** sesi ujian memakai `requireSeb=true` +
`maxViolations` wajar (mis. 5) dan pantau papan monitoring proktor. Pelanggaran
serius → guru/proktor **kumpulkan paksa** attempt tersebut.

> APK ini ≈ setara perlindungan SEB desktop untuk BYOD: mencegah kecurangan
> pasif (screenshot/copy/tab-lain) dan mencatat yang aktif. Bukan anti-curang
> mutlak — kombinasi dengan pengawasan proktor tetap diperlukan.

## 5. Alur ujian siswa (apa yang dilihat siswa)

1. Buka **SEB SMAN 1 Gorontalo** → langsung halaman login CBT (split-screen "Aurora").
   Setiap membuka aplikasi (termasuk setelah tidak sengaja ditutup/di-swipe),
   aplikasi **selalu** menampilkan halaman login — sesi tidak pernah terbawa.
2. Login dengan **NISN + password** → daftar ujian.
3. Ujian wajib SEB menampilkan badge **SEB**; tekan **token 6 digit** dari
   proktor → mulai ujian (ruang ujian dengan timer & anti-cheat sama seperti web).
4. APK tidak menampilkan nilai; hasil keluar setelah guru publish.

## 6. Build dari source & tanda tangan

Struktur: `apps/seb-android/` (Flutter, di luar npm workspaces).

```powershell
cd apps\seb-android
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'   # JBR Android Studio
flutter pub get

# Universal ARM (arm+arm64), tanpa x86 — build distribusi utama:
flutter build apk --release --target-platform android-arm,android-arm64

# Varian per-ABI (paling kecil):
flutter build apk --release --split-per-abi --target-platform android-arm,android-arm64

flutter analyze                              # 0 issue
flutter test                                 # 10/10 (URL normalize + LAN default http, fingerprint, splash)
```

Catatan build:
- APK distribusi **tidak memuat x86/x86_64** (kecuali satu lib kecil bawaan
  plugin, ~0.1 MB). Emulator x86_64 dipakai dengan **build debug**, bukan
  release distribusi.
- R8 (minify) + `isShrinkResources` aktif untuk release; icon MaterialIcons
  di-tree-shake otomatis (−99.8%).
- `minSdk = 29` (Android 10) — distribusi perangkat sekolah; `targetSdk` =
  bawaan Flutter (Android 16/API 36 di toolchain saat rilis).
- `android/gradle.properties` wajib memuat `kotlin.incremental=false`
  (workaround error "Could not close incremental caches" di Windows).
- Flag QA tersembunyi `--dart-define=QA_WEBVIEW_DEBUG=true` mengaktifkan
  WebView debugging (HANYA untuk pengujian internal, mis. otomasi CDP).
  **Build distribusi tidak menggunakannya** (default `false`).
- **Ganti PIN operator** tanpa ubah source:
  `flutter build apk --release --dart-define=OPERATOR_PIN=pinbaru`
  (default `sman1gorontalo2026`).
- Keystore release: `apps/seb-android/android/app/key.jks` + `android/key.properties`
  (`storeFile=key.jks`, alias `seb-cbt`). **RAHASIA — jangan dibagikan,
  jangan di-commit.** Salinan backup ada di luar repo
  (`C:\Users\Administrator\seb-cbt-backup\`).
  **Bila keystore hilang, APK tidak bisa di-update di perangkat** (harus
  uninstall dulu → konfigurasi operator hilang, harus diisi ulang).
- Sertifikat v1.0.0+: `CN=SMAN 1 Gorontalo, OU=CBT, O=SMAN 1 Gorontalo, L=Gorontalo`
  SHA-256 `7de0d018…8fdd1888`.
- SHA-256 file APK:
  - v2.1.1 (universal ARM, 32.3 MB): `EB42BA7FE198086A1CE2B399E149DC56BA042891C2D2155A1ED9E620A0475A50`
  - v2.1.1-arm64-v8a (18.2 MB): `35618BD878B7B5C653F4EF77DF9A4C2B0247A9CA1B140F9ABF60B118396C908F`
  - v2.1.1-armeabi-v7a (15.7 MB): `D2A1D343C250915F8FAD44F46BD6D4C7ECB9F57481D9DEDEB264D073E2C94E6D`
  - v2.1.0 (universal ARM, 32.3 MB): `3B7A44D8000A749B364C86998A126097DDDD1BFD43C631E637266CB5E177F13C`
  - v2.1.0-arm64-v8a (18.2 MB): `182140EA9930302800864F8540D9F269B0F588912F4B8ADCA0B156CC412B33EA`
  - v2.1.0-armeabi-v7a (15.7 MB): `06CF8A466E8DC48B1A04807F060DE52A4AED09673F02BB4BE2F48B1DF79D2735`
  - v2.0.0 (universal ARM, 32.2 MB): `871653A65380E8F917F0CA2BA0BADECB30B4A211BCB4D5FB5DD90FB5955D9C9F`
  - v2.0.0-arm64-v8a (18.1 MB): `3A148DA45EE3E0EBE8257872775B82DF926B4C13D0231BCBE7A0429400D0FBEE`
  - v2.0.0-armeabi-v7a (15.6 MB): `B0E349EFF378BC5B8F2491D2AC259809EFD604AD7089FA8D1ACB69B05D73C30B`
  - v1.2.0: `EA89ACBDB2D0007529213CFD6B650AAC0608323C7E08156C93C56039FA2E367C`
  - v1.1.0: `FC72292A95D19BEA69D2978456E3B9BE295589436988052981C777A94B52C39A`
  - v1.0.0: `EA4959571C35B9E2E46C51F039C30BC8C62DA0D9D2E977DAAC155C774CC22DA5`

Naikkan `version:` di `pubspec.yaml` (mis. `2.1.0+5`) untuk rilis berikutnya;
`versionCode` (`+5` dst) wajib naik setiap upload/sideload update.

## 7. Rotasi Browser Exam Key

1. Server: ganti `SEB_BROWSER_EXAM_KEY` di `.env` (produksi) → `docker compose up -d api`.
2. Setiap perangkat: mode operator → **Set/ganti Browser Exam Key** → key baru.
3. Verifikasi fingerprint 8 hex sama di semua perangkat (`sha256(key)[:8]`).
4. (Opsional) putar key bila bocor; siswa dengan key lama langsung gagal
   `sebVerified` di sesi wajib SEB.

Beberapa key sekaligus didukung server (dipisah koma) — berguna saat masa
transisi rotasi: key lama + baru sama-sama valid selama transisi.

## 8. Troubleshooting

| Gejala | Penyebab | Tindakan |
|---|---|---|
| `400` saat mulai ujian / semua endpoint attempt | Key di perangkat ≠ key server, atau key server kosong + sesi wajib SEB → `503` | Mode operator → **Uji key ke server** (verifikasi 1 ketuk tanpa login); isi key yang benar; cek `.env` server + restart api |
| Badge SEB tidak muncul tapi `requireSeb=true` | Sesi tidak wajib SEB, atau siswa login dari browser biasa | Cek `requireSeb` sesi; pastikan siswa membuka **APK**, bukan browser |
| Layar "Tidak dapat memuat CBT" / `ERR_NAME_NOT_RESOLVED` | Base URL salah/terhapus | Mode operator → perbaiki Base URL persis URL produksi (https) |
| Layar Konfigurasi operator muncul lagi | App data terhapus / APK di-uninstall | Isi ulang URL + key (semudah pemasangan pertama) |
| APK menampilkan "Tidak dapat memuat CBT" padahal browser HP bisa membuka IP server | (v2.0.0 ke bawah) cleartext HTTP diblokir Android | **Pasang v2.1.0** — cleartext HTTP untuk LAN diizinkan; atau tulis Base URL `http://<ip>:<port>` secara eksplisit (v2.1.0 otomatis default `http://` untuk IP privat). Pastikan HP & PC satu jaringan |
| `net::ERR_CLEARTEXT_NOT_PERMITTED` | Diblokir karena `http://` tanpa izin | Pakai v2.1.0+; atau pakai HTTPS yang valid di server |
| Server lab via IP PC tanpa TLS tidak bisa dibuka | Base URL tersimpan sebagai `https://<ip>` | Mode operator (7×) → **Base URL server** → ganti ke `http://<ip>:8080` (atau tulis IP polos — v2.1.0 otomatis jadi `http://`) |
| Ujian jalan tapi `sebVerified=false` di monitoring | Key belum diisi / salah | Isi key; siswa buka ulang APK; mulai ulang attempt |
| `503` | `SEB_BROWSER_EXAM_KEY` server kosong | Isi key, `docker compose up -d api` |
| Ujian tidak tersimpan / error koneksi | Jaringan HP buruk | Periksa WiFi lab/proyektor hotspot; autosave tetap jalan saat online kembali |
| "PIN keluar belum diatur oleh admin sekolah" saat menutup APK | Admin belum mengatur PIN keluar | Admin → Pengaturan → kartu **"PIN Keluar APK SEB"** → Simpan PIN; semua HP langsung bisa |
| "PIN salah" terus / "Terlalu banyak percobaan" | Salah PIN berulang (5 menit, ≥10×) | Tunggu 5 menit; minta PIN benar ke admin; admin bisa ganti PIN di Pengaturan (berlaku seketika) |
| "Tidak bisa terhubung" saat Keluar aplikasi | Tidak ada internet/server | PIN keluar **diverifikasi ke server** — hubungkan jaringan/server, lalu coba lagi (fail-closed: APK tidak bisa ditutup tanpa verifikasi) |
| APK lama (v1.x) "SEB CBT" ingin tampil terbaru | Nama app diganti v2.0.0 | Pasang `SEB-SMAN1-Gorontalo-v2.0.0*.apk` di atas v1.x — package ID & sertifikat sama, konfigurasi tersimpan |

## 9. Verifikasi cepat (untuk guru/proktor)

1. Buka sesi wajib SEB sebagai siswa **dari APK** → mulai ujian.
2. Papan **Monitoring** proktor → kolom `sebVerified` peserta = `true`.
3. Siswa yang membuka dari browser biasa → minta login → klik mulai →
   ditolak dengan "Verifikasi Safe Exam Browser gagal".

Lihat juga `docs/API.md` ("Verifikasi Safe Exam Browser") dan
`docs/DEPLOYMENT.md` (Caddy/HTTPS, rotasi).

## 10. Changelog

**v2.1.2 (16 Nov 2026)** — perbaikan bug bridge SEB + kebocoran HttpClient + SHA-256 rilis:

- **`SebBridge.requestHash` rentan crash untuk payload non-string**: di
  `_onBridgeMessage`, `payload['id'] as String?` dan `payload['url'] as String?`
  melempar `TypeError` bila halaman mengirim nilai non-string (mis. angka) —
  hashing URL SEB gagal diam-diam dan soal tidak bisa dibuka. Kini memakai
  `?.toString() ?? ''` (aman untuk semua tipe JSON).
- **HttpClient tidak pernah ditutup bila request gagal** (mode uji key &
  verifikasi PIN keluar): koneksi bocor hingga GC. Kini `client.close(force: true)`
  di `finally` pada kedua jalur.
- **`cupertino_icons` 1.0.9 → 2.0.0** (satu-satunya direct dependency yang
  tertinggal major).
- Verifikasi: `flutter analyze` 0 issue; `flutter test` 10/10; `flutter build apk
  --release` (universal 50,2 MB) dan `--split-per-abi` (arm64 18,2 MB /
  armeabi-v7a 15,7 MB / x86_64 19,6 MB).
- **SHA-256 APK v2.1.2**:
  - universal (`SEB-SMAN1-Gorontalo-v2.1.2.apk`):
    `2C86C88CE3C0B3FBFB6AAA459B71DA2EF9584B637314D67C8075CC7A0938D54B`
  - arm64-v8a (`SEB-SMAN1-Gorontalo-v2.1.2-arm64-v8a.apk`):
    `F623E738A8306D2169C749EEFAD904F7ECAF1C95D1E20BA47939FFB26ADE8B8B`
  - armeabi-v7a (`SEB-SMAN1-Gorontalo-v2.1.2-armeabi-v7a.apk`):
    `A3D094B0C54FE47ED10D6643FC473E6949C09DA3F72B8408F9A96CE3FC9F5A12`
  - x86_64 (`SEB-SMAN1-Gorontalo-v2.1.2-x86_64.apk`):
    `AFADE73475126DA0E95D67E0E818C03DCD53F3B2F23EAC43A743B2DFE3F30B53`

**v2.1.1 (14 Nov 2026)** — akses mode operator lebih andal + dokumen anti-salah-PIN:

- **Mode operator kini bisa dibuka 2 cara**: (1) ketuk **7× sudut kiri-atas**
  (jeda reset diperlonggar dari 1,2 → **1,5 detik** untuk HP low-end),
  (2) **tahan tombol Refresh biru ±2 detik**. Keduanya tetap meminta
  **PIN operator** (`sman1gorontalo2026` bawaan) — tidak ada jalan pintas
  tanpa PIN.
- **Dokumentasi §3 dipecah**: tabel perbandingan **PIN operator vs Browser
  Exam Key vs PIN keluar** + menu diberi judul "ganti exam key di sini";
  kasus salah masukkan key ke "PIN operator" (kesalahan paling umum)
  diberi peringatan "JANGAN TERTUKAR".
- Verifikasi: `flutter analyze` 0 issue; `flutter test` 10/10; build release OK.

**v2.1.0 (14 Nov 2026)** — perbaikan akses server LAN + tombol Keluar terlihat + splash minimal + layar error:

- **APK tidak bisa membuka server via IP PC (padahal browser bisa)** —
  penyebabnya `usesCleartextTraffic=false` memblokir `http://`; Android
  menolak dengan `ERR_CLEARTEXT_NOT_PERMITTED`. Diperbaiki:
  - `android:networkSecurityConfig="@xml/network_security_config"`
    (`base-config cleartextTrafficPermitted="true"`) — cleartext HTTP
    diizinkan (server lab via IP tanpa TLS). Untuk produksi publik tetap
    WAJIB HTTPS (Caddy); bila kelak pindah domain HTTPS resmi, izin ini
    bisa dihapus.
  - `normalizeBaseUrl`: host **IP privat** (10.x, 127.x, 192.168.x,
    172.16–31.x), `localhost`, dan `[::1]` **tanpa skema otomatis di-default
    ke `http://`**; host publik tetap `https://`. Eksplisit `http(s)://`
    selalu dihormati. IPv6 mentah tetap tulis dengan kurung siku.
  - Layar Konfigurasi operator kini menulis contoh `http://192.168.x.x:8080`
    + kalimat "Server lab tanpa HTTPS: tulis http:// + IP PC".
- **Tombol Keluar selalu terlihat**: ikon power merah mengambang di
  **kiri bawah layar** (Refresh biru tetap di kanan bawah) — langsung
  membuka dialog **PIN keluar admin** (tanpa lewat menu operator).
  Sama di layar error jaringan (tombol **KELUAR (PIN ADMIN)**) sehingga
  perangkat tidak pernah "terkunci" di layar gagal tanpa jalan keluar.
- **Layar error jaringan ditulis ulang**: ikon wifi-off dalam cincin brand,
  teks penyebab, **Base URL yang dicoba** (bisa di-select untuk dicocokkan),
  deskripsi teknis error, tombol **COBA LAGI** (emas), tombol **KELUAR
  (PIN ADMIN)** (garis merah), petunjuk jaringan + jalan ke mode operator
  (7× sudut kiri atas).
- **Splash tidak terlalu cepat**: boot splash minimal 0,9 dtk dan splash
  muat halaman minimal 2,1 dtk sejak cold start — efek merek (logo +
  wordmark "SEB") terasa, tanpa menambah waktu bila halaman lambat.
  Reload manual tetap responsif (tanpa jeda minimal).
- Verifikasi: `flutter analyze` 0 issue; `flutter test` **10/10** (tambah
  kasus LAN default-http); build release ARM-only OK; aapt badging sesuai
  (`id.sch.sman1gorontalo.seb`, versionCode 5, label "SEB SMAN 1 Gorontalo",
  sdkVersion 29, targetSdk 36, manifest merged memuat
  `networkSecurityConfig`); suite Docker (`verify-upgrade` 25/25,
  `verify-roles` 180/180) tetap hijau dari v2.0.0.

**v2.0.0 (14 Nov 2026)** — ganti nama + keluar wajib PIN admin + performa + perbaikan bug:

- **Ganti nama aplikasi**: "SEB CBT SMAN 1 Gorontalo" → **"SEB SMAN 1 Gorontalo"**
  (label APK, judul window, layar Konfigurasi operator, splash, docs).
  Package ID (`id.sch.sman1gorontalo.seb`) dan sertifikat **tidak berubah** —
  update in-place dari v1.x mempertahankan Base URL & Browser Exam Key.
  Splash: wordmark kini "SEB" besar + watermark "SEB", tagline tetap.
- **Keluar APK wajib PIN admin** (sebelumnya "Tutup aplikasi" hanya di balik
  PIN operator bawaan di source):
  - Mode operator → **Keluar aplikasi** → dialog **PIN keluar** →
    diverifikasi ke server `POST /api/seb/exit-verify` (fail-closed:
    tanpa jaringan, APK tidak tertutup).
  - Admin mengatur PIN di web **Pengaturan → "PIN Keluar APK SEB"**:
    `GET/PUT/DELETE /api/settings/seb-exit-pin` (ADMIN, terkunci ke sekolah);
    **disimpan SHA-256 hex** di `GlobalConfig.SEB_EXIT_PIN` — tidak pernah
    dikembalikan ke klien (tidak ikut di `GET /api/settings` / generic upsert
    ditolak karena di luar `CONFIG_KEYS`); audit `SEB_EXIT_PIN_SET`/`SEB_EXIT_PIN_CLEAR`
    tanpa mencatat PIN.
  - Rate-limit per sekolah+IP: **≥10 salah / 5 menit → 429**. PIN kosong /
    belum diatur → dialog menjelaskan; tombol keluar **nonaktif** sampai
    admin mengatur.
  - Keluar disengaja **tidak lagi memicu alarm / WINDOW_BLUR** — guard
    `_exitInProgress` di lifecycle native & Flutter; lepas screen pinning
    dulu baru `SystemNavigator.pop()`.
- **Performa & responsif (Android 10 sampai terbaru)**:
  - R8 minify + `isShrinkResources`; MaterialIcons di-tree-shake;
    build ARM-only (universal 32.2 MB; arm64 18.1 MB; armeabi-v7a 15.6 MB).
  - `minSdk = 29` (Android 10); `targetSdk` 36 (Android 16); hardware
    acceleration; immersive sticky; portrait lock; `resizeableActivity=false`.
  - WebView Android khusus: **overscroll glow dimatikan**
    (`setOverScrollMode(never)` → scroll lebih ringan & responsif),
    **mixed content dilarang** (`neverAllow`), `useWideViewPort(true)` +
    `textZoom(100)` (rendering tajam tanpa skala ganda),
    geolocation / akses file / akses content **dimatikan**,
    Payment Request & WebAuthn **dimatikan**.
  - `allowBackup=false` + `fullBackupContent=false` (token sesi WebView
    tidak ikut Auto Backup Google).
- **Perbaikan bug**:
  - Reload halaman (tombol Refresh / relogin paksa) sebelumnya tidak
    menampilkan splash & progres (state `_webReady` tidak direset di
    `onPageStarted`) — splash sekarang determinate lagi setiap page load.
  - Back sistem sebelumnya diam total; kini back menutup keyboard
    (tanpa keluar dari aplikasi).
  - Field PIN (operator & keluar) kini mematikan autocorrect / saran
    keyboard / autofill; PIN keluar memakai keyboard angka.
  - PIN operator kini bisa diganti saat build via
    `--dart-define=OPERATOR_PIN=...` (default tetap `sman1gorontalo2026`).
  - Layar Fatal "Tidak dapat memuat CBT" kini konsisten: setiap load
    ulang me-reset progres & status siap.
- **Verifikasi v2.0.0**: `flutter analyze` 0 issue; `flutter test` 8/8;
  build release ARM-only OK; badging `aapt` sesuai (label "SEB SMAN 1
  Gorontalo", sdkVersion 29, targetSdk 36, permissions INTERNET+VIBRATE);
  API `exit-verify` diuji end-to-end di Docker (set → salah/benar/hapus;
  isolasi per sekolah sman1/sman8; nilai tidak bocor ke `/api/settings`);
  suite `verify-upgrade` 25/25 & `verify-roles` 180/180 tanpa regresi.
  On-device E2E (fisik/emulator) belum dijalankan ulang untuk v2.0.0 —
  **dianjurkan uji 1 perangkat sebelum distribusi massal**.
- **Referensi dipakai (pencarian internet/GitHub, 14 Nov 2026)** —
  tidak ada SEB resmi untuk Android; APK ini setara "custom SEB kiosk".
  Proyek yang ditinjau:
  - `github.com/SafeExamBrowser` — organisasi resmi SEB (seb-server, seb-mac,
    seb-win); menegaskan **tidak ada Android SEB resmi** → pendekatan kiosk
    WebView kita adalah jalur yang dipakai industri.
  - `github.com/nktnet1/webview-kiosk` (Webview Kiosk, AGPL-3.0) — referensi
    UX kiosk: lock task, password-to-exit, izin minimal (INTERNET saja).
  - `github.com/pouriabagheri/kiosk-browser` (Apache-2.0) — pola
    "pola rahasia → dialog kata sandi untuk keluar kiosk" yang diadaptasi
    menjadi "PIN keluar admin (diverifikasi server)".
  - `github.com/vianziro/ExamBrowser-Android` — exam browser Android (ID):
    WebView kiosk + swipe-to-refresh; validasi pola "swipe refresh melayang".
  - `github.com/Foolian2/openexam` — self-hosted exam + SEB; memvalidasi
    arsitektur "server-side gate (hash) + fail-closed", mirip server CBT kita.
  - `github.com/Niranjan266/Safe-Exam-browser`, `github.com/Sofianali2019/…` —
    implementasi Flask/Flutter lain; catatan threat-model: kiosk mempersempit,
    bukan menghilangkan, kecurangan — pengawasan proktor tetap diperlukan.
- Saran lanjutan (belum dikerjakan, butuh keputusan): preconnect DNS ke
  server dari APK, penulisan ulang list besar di web ujian (virtualisasi),
  pelaporan insiden otomatis ke server saat force-exit gagal.
**v1.2.0 (13 Nov 2026)** — update besar (perbaikan bug + kunci layar + alarm + login ulang):
- **Layar terkunci (screen pinning)**: layar kiosk kini melakukan
  `startLockTask()` — OS menahan siswa di dalam aplikasi (Home/Recents/
  notifikasi terkunci). Lepas pin hanya via gerakan OS (Recents + Kembali,
  + PIN bila perangkat disetel). Dialog konfirmasi "App is pinned" tampil
  saat pertama kali kiosk dibuka; dapat dimatikan di mode operator
  ("Kunci layar"). `startLockTask` juga memanggil pin ulang otomatis
  setelah kembali dari background.
- **Wajib login ulang setiap membuka aplikasi**: saat aplikasi ditinggalkan
  (`onPause` native — selalu terpanggil, termasuk tombol power) atau dibunuh,
  token sesi web (`cbt_token`/`cbt_refresh`) + `sessionStorage` dihapus;
  membuka kembali aplikasi selalu berakhir di halaman login. Cold start,
  resume, dan kill dari Recents semuanya diverifikasi (token `null` +
  halaman login, via ADB/CDP di emulator Android 15).
- **Alarm pelanggaran**: setiap siswa meninggalkan aplikasi (Home/Recents/
  power — terdeteksi di native `onPause`/`onUserLeaveHint`, andal walau
  WebView beku), HP membunyikan ringtone alarm di **stream ALARM** (tidak
  bisa disenyapkan tombol volume) + getar. Alarm juga berbunyi untuk
  **semua pelanggaran lain yang dicatat web** (pindah tab, keluar
  fullscreen, copy/tempel, menu konteks) via bridge `SebBridge.alarm`
  (berlaku di dalam APK saja).
- **Bug diperbaiki**:
  - Pelanggaran saat app keluar bisa tidak tercatat karena `runJavaScript`
    dijalankan saat WebView sudah beku — kini deteksi pindah ke native
    `onPause` (JS tetap dicoba, best-effort).
  - Re-login pada transisi sangat cepat (Home lalu buka lagi dalam hitungan
    detik) bisa terlewat Flutter lifecycle — listener lifecycle native
    (`onPause`/`onResume` lewat MethodChannel) kini menjadi sumber utama,
    Flutter observer sebagai fallback (keduanya idempoten via `_leftApp`).
  - APK tampil di daftar Recent Apps — kini `excludeFromRecents=true`
    (ditambah `FLAG_SECURE` yang sudah ada).
  - Build release mengizinkan traffic HTTP (`usesCleartextTraffic=true`)
    — kini `false` (build debug tetap mengizinkan untuk emulator/dev).
  - `main` manifest mendapat izin `VIBRATE` (untuk pola getar alarm).
  - Dialog konfirmasi screen pinning bisa memicu deteksi "keluar aplikasi"
    palsu — diberi jendela supervisi 3 detik (`suppressAlarm`) di kedua sisi.
  - `hidden` + `paused` bisa menggandakan pencatatan `WINDOW_BLUR` — kini
    satu pelanggaran per backgrounding (guard `_leftApp`).
- **Layar splash bermerek** (baru): app dibuka → native splash (logo
  sekolah di latar gelap) → splash Flutter — logo pentagon dikelilingi
  cincin pemindai biru berputar, "SMAN 1 GORONTALO" (emas, letterspaced),
  "SEB CBT" (Plus Jakarta ExtraBold), tagline "Ujian yang jujur, dikerjakan
  dengan tenang." (Fraunces italic, gradien), progress bar gradien biru→emas
  (determinate saat halaman dimuat), watermark "CBT" samar, footer
  "COMPUTER BASED TEST · TAHUN AJARAN 2026/2027" + "TERENKRIPSI & AMAN".
  Splash juga tampil saat halaman web dimuat (determinate) dan saat reload
  manual (tombol refresh). Font: Plus Jakarta Sans (konversi woff2→ttf via
  fonttools) + Fraunces, terdaftar di pubspec.
- Verifikasi: `flutter analyze` 0 issue; `flutter test` 8/8; E2E di emulator
  Android 15 — cold start → login → HOME → buka kembali: token terhapus,
  halaman Login; app tetap ter-pin saat tombol Home (dengan pinning aktif);
  bridge alarm `ALARM_POSTED` tanpa error; web bundle ter-build bersih
  (`vite build` 0 error).



**v1.1.0 (13 Nov 2026)** — perbaikan dari uji coba pengguna:
- **Tombol Refresh** mengambang di kanan bawah (di setiap halaman) — memuat ulang halaman.
- **Performa scroll/loading lebih halus**: progres halaman kini dikuantisasi (10%)
  sehingga widget utama tidak rebuild di setiap persen — beban repaint turun drastis
  (terutama di HP low-end; tetap WebView, bukan native list).
- **Uji key ke server** (mode operator): memverifikasi key perangkat terhadap
  `SEB_BROWSER_EXAM_KEY` di server lewat `GET /api/seb/self-test` (publik,
  tanpa login) — menampilkan hasil cocok/tidak cocok/server belum siap +
  sidik jari keduanya. Ini penyebab umum "tidak bisa ikut ujian saat Wajib SEB":
  key perangkat kosong/salah.
- Layar **Konfigurasi operator**: menampilkan **sidik jari** key yang diketik
  secara langsung, plus peringatan merah bila key dikosongkan.

**v1.0.0 (13 Nov 2026)** — rilis pertama: kiosk WebView, SHA-256 bridge
(kompatibel `X-SafeExamBrowser-RequestHash`), hidden operator menu, immersive,
FLAG_SECURE, FLAG_KEEP_SCREEN_ON, back diblokir, hanya origin server.
