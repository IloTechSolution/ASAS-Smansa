# SEB SMAN 1 Gorontalo — Aplikasi Android (Tauri)

Aplikasi ujian berbasis Android untuk siswa, nama APK: **SEB SMAN 1 Gorontalo**.

## Kebutuhan
- **Dukungan**: Android 10+ (minSdk 29).
- **Stack**: [Tauri mobile](https://v2.tauri.app/develop/mobile/) — logika inti aplikasi penuh Rust, UI webview (frontend).

## Kebutuhan Fungsional (dari permintaan)
1. **Langsung ke login** — halaman pertama yang muncul adalah halaman login (tidak ada splash/intro).
2. **Deteksi aplikasi lain** — jika ada aplikasi lain terbuka (atau floating window/apps di atas), aplikasi ujian mendeteksi dan **tidak boleh login** (blokir login). *TODO implementasi platform-specific: deteksi via Android API (mis. window-flags / usage-stats) — lihat catatan di src-tauri.*

## Struktur
```
android/
├── src-tauri/          # inti aplikasi (Rust/Tauri)
│   ├── src/main.rs     # entry point
│   ├── Cargo.toml
│   └── tauri.conf.json
└── frontend/           # UI web (login)
    ├── index.html      # halaman login
    └── package.json
```

## Mulai
1. `cd src-tauri && cargo tauri init` (atau `cargo install tauri-cli` + `cargo tauri init`).
2. Build Android: `cargo tauri build --mobile` / `tauri build --target aarch64-linux-android`.
3. minSdk 29: sesuaikan `AndroidManifest.xml`/`tauri.conf.json` bila perlu.
