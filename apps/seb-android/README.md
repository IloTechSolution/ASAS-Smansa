# SEB SMAN 1 Gorontalo — Android

APK kiosk **Safe Exam Browser** kustom untuk ujian CBT (BYOD, sideload, tanpa
Play Store). WebView + Flutter; Android 10 (API 29) sampai terbaru.

- Display name: **SEB SMAN 1 Gorontalo** (label, window title, splash)
- Package ID: `id.sch.sman1gorontalo.seb` (tetap sejak v1.0.0)
- Versi: **2.1.1** (versionCode 6)
- Dokumentasi lengkap: [`docs/SEB-ANDROID.md`](../../docs/SEB-ANDROID.md)

## Fitur

- Kiosk WebView penuh: screen pinning, FLAG_SECURE, immersive, portrait lock
- Wajib login ulang setiap membuka aplikasi (token sesi web dihapus saat ditinggalkan/dibunuh)
- Alarm + getar saat siswa meninggalkan aplikasi (stream ALARM, tidak bisa dimatikan)
- Alarm untuk semua pelanggaran dari web (SebBridge): tab/fullscreen/copy-paste
- Verifikasi SHA-256 Browser Exam Key (`X-SafeExamBrowser-RequestHash`) — sesi `requireSeb`
- Mode operator tersembunyi (7 ketukan sudut kiri-atas + PIN operator):
  Base URL, Browser Exam Key, uji key ke server, kunci layar, **Keluar aplikasi**
- **Keluar APK wajib PIN yang diatur admin** (Pengaturan web), diverifikasi ke
  server `POST /api/seb/exit-verify` (fail-closed; rate-limit 10 salah / 5 menit → 429).
  Tombol keluar (ikon power) selalu terlihat di kiri bawah layar
- **HTTP untuk jaringan lab diizinkan** (IP privat default `http://`), HTTPS untuk publik

## Build

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
flutter pub get
flutter build apk --release --target-platform android-arm,android-arm64   # universal ARM
flutter build apk --release --split-per-abi --target-platform android-arm,android-arm64
flutter analyze   # 0 issue
flutter test      # 8/8
```

Opsi build:

- `--dart-define=OPERATOR_PIN=...` ganti PIN mode operator (default `sman1gorontalo2026`)
- `--dart-define=QA_WEBVIEW_DEBUG=true` WebView debugging (HANYA QA internal)
- `--dart-define=QA_BASE_URL=...` prefill Base URL + Browser Exam Key (HANYA QA)

Artefak signed tersedia di `dist-seb/`:

| Berkas | Ukuran | Catatan |
|---|---|---|
| `SEB-SMAN1-Gorontalo-v2.1.1.apk` | 32.3 MB | ARM universal (rekomendasi default) |
| `SEB-SMAN1-Gorontalo-v2.1.1-arm64-v8a.apk` | 18.2 MB | HP 64-bit, paling ringan |
| `SEB-SMAN1-Gorontalo-v2.1.1-armeabi-v7a.apk` | 15.7 MB | HP 32-bit Android 10 |

SHA-256 & cara update dari v1.x: lihat `docs/SEB-ANDROID.md` §2 dan §6.
