# Design: alarm pelanggaran terdengar (buka kunci audio + volume kiosk)

Tanggal: 2026-11-18 · Status: **menunggu persetujuan**

## Intent / why

Siswa membuka CBT di HP dan alarm pelanggaran harus terdengar jelas. Dua hambatan:
autoplay policy browser membuat `AudioContext` baru tetap `suspended` sampai ada
sentuhan pengguna (alarm dipicu oleh event *blur*/keluar tab, yang bukan gesture),
dan browser sama sekali tidak punya API untuk menaikkan volume sistem HP.
Di APK SEB, volume stream ALARM bisa diatur native.

## Goals

- Alarm pelanggaran terdengar di browser HP dan di APK SEB.
- Audio dibuka/diresume lebih awal, saat siswa masih menyentuh tombol.
- Gain alarm dinaikkan sejak siswa masuk, tanpa tombol/UUI tambahan.

## Non-goals

- Menaikkan volume sistem dari browser biasa (mustahil — tidak ada Web API).
- Mengabaikan sakelar silent iOS untuk audio lewat browser (stream media tetap dibungkam).

## Anti-goals

- Alarm dipicu event *blur* sebelum `AudioContext` sempat di-unlock (tetap diam).
- Volume `STREAM_ALARM` di APK tetap rendah saat ujian berjalan.

## Constraints

- Web Audio memakai stream media browser; gain maksimum internal tidak bisa melewati volume sistem.
- `SebBridge` di APK sudah ada (`requestHash`, `alarm`) dan diinjeksikan lewat polyfill JS.
- Keystore APK tidak ikut ke repo GitHub — build signed tetap di mesin yang punya keystore.

## Approaches

1. **Browser saja** — unlock audio saat masuk + gain alarm lebih besar. Murah, tapi tetap bergantung volume siswa dan sakelar silent.
2. **APK saja** — set `STREAM_ALARM` ke maksimum native. Paling kuat, tapi hanya untuk siswa yang pakai APK.
3. **Kombinasi (dipilih)** — #1 untuk semua browser + #2 untuk kiosk. Biaya kecil karena `alarm.ts` dan `SebBridge` sudah ada.

## Keputusan implementasi

**Web**

- `apps/web/src/lib/alarm.ts`: ekspor `unlockAudio()` — buat/resume `AudioContext` di dalam gesture lalu putar buffer diam sangat pendek. Gain alarm naik `0.4 → 0.9`.
- `apps/web/src/pages/Login.tsx`: panggil `unlockAudio()` di `onSubmit` sebelum `login()`.
- `apps/web/src/pages/siswa/SiswaUjian.tsx`: panggil `unlockAudio()` di `start()` (gesture token). Tidak ada tombol/teks baru di UI.
- `apps/web/src/lib/seb.ts`: tambah `sebMaximizeVolume()` → `window.SebBridge?.maximizeVolume?.()` (no-op di browser); deklarasi tipe `Window.SebBridge` diperbarui.

**APK SEB**

- `MainActivity.kt`: method channel baru `maximizeAlarmVolume` → `AudioManager.setStreamVolume(STREAM_ALARM, getStreamMaxVolume(STREAM_ALARM), 0)`. Hanya `STREAM_ALARM` (alarm ringtone memakai `USAGE_ALARM`, bukan `STREAM_MUSIC`).
- `kiosk_screen.dart`: polyfill `SebBridge.maximizeVolume` mengirim `{type:'maximizeVolume'}`; `_onBridgeMessage` meneruskannya ke channel. Dipanggil sekali saat WebView siap (`webReady`) dan bisa dipanggil ulang dari web lewat `sebMaximizeVolume()`.
- Tidak ada restore otomatis ke volume lama (perangkat kiosk dipakai untuk ujian).

## Verifikasi

- `npm run build -w @cbt/web` dan `npm run lint -w @cbt/web`.
- `flutter analyze` di `apps/seb-android`.
- Manual browser HP: login → memicu violation (pindah tab) → alarm terdengar lebih keras.
- Manual APK: cek level `STREAM_ALARM` di maksimum saat kiosk aktif.

## Yang tersisa untuk builder

- Nilai gain `0.9` bisa disetel ulang setelah uji dengar di perangkat sekolah.
