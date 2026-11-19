# Alarm Pelanggaran Terdengar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alarm pelanggaran terdengar jelas di browser HP dan di APK SEB, tanpa tombol/UUI baru.

**Architecture:** Web membuka `AudioContext` di dalam gesture login/gate token dan menaikkan gain alarm ke `0.9`. APK menambah method channel native untuk menyetel `STREAM_ALARM` ke maksimum, dipanggil lewat `SebBridge.maximizeVolume()` yang diinjeksikan ke WebView. Keduanya saling melengkapi: browser tetap tunduk pada volume sistem, APK benar-benar mengubah volume alarm.

**Tech Stack:** TypeScript/React 19 (web), Web Audio API, Kotlin + Flutter/Dart (APK SEB), `node:test` + `tsx` (unit web), Playwright (E2E), `flutter test`.

**Spec:** `docs/superpowers/specs/2026-11-18-alarm-audio-volume-design.md`

## Global Constraints

- Gain alarm = `0.9` (konstanta `ALARM_GAIN`), bukan `0.4`.
- Tidak ada tombol "Uji alarm", tidak ada teks baru di UI siswa.
- Browser tidak bisa mengubah volume perangkat — jangan klaim demikian di kode atau UI.
- APK hanya mengubah `STREAM_ALARM` (alarm memakai `USAGE_ALARM`), bukan `STREAM_MUSIC`.
- Tanpa restore volume otomatis setelah ujian.
- Repo sumber `E:\Moodle\Moodle` belum ber-git; langkah commit tidak dimasukkan. Folder rilis `E:\Moodle\cbt-sman1-github` sudah ber-git dan di-stage di Task 5.

## Review Focus

1. Alarm dipicu event `blur` (bukan gesture) → `AudioContext` harus sudah terbuka sejak login. Test: Task 1 `unlockAudio`, Task 3 E2E.
2. Gain berlebih memotong/distorsi → `ALARM_GAIN = 0.9`, bukan `1.0`. Test: Task 1.
3. Browser biasa tidak punya `SebBridge` → `sebMaximizeVolume()` harus no-op tanpa throw. Test: Task 2.
4. APK dalam mode silent → alarm tetap terdengar karena `STREAM_ALARM`, bukan `STREAM_MUSIC`. Test: Task 4 (inspeksi kode + uji perangkat).
5. Keystore APK tidak ikut repo GitHub → build signed hanya di mesin yang punya keystore. Test: Task 5.

---

### Task 1: Buka kunci audio dan naikkan gain alarm (`lib/alarm.ts`)

**Files:**
- Modify: `apps/web/src/lib/alarm.ts`
- Create: `apps/web/src/lib/alarm.test.ts`

**Interfaces:**
- Consumes: Web Audio API (`AudioContext`, `createBuffer`, `createBufferSource`, `createOscillator`, `createGain`).
- Produces: `export const ALARM_GAIN: number = 0.9`, `export function unlockAudio(): void`, `export function playAlarm(long?: boolean): void` (tetap, gain diganti).

- [ ] **Step 1: Tulis test gagal** di `apps/web/src/lib/alarm.test.ts` dengan `node:test`:
  - Test A: stub `globalThis.window` berisi `AudioContext` tiruan (`state: 'suspended'`, `resume()` mengubah jadi `'running'`, `createBuffer`/`createBufferSource` mencatat pemanggilan, `currentTime = 0`, `sampleRate = 48000`, `destination = {}`). Import modul dengan query unik (`import('../src/lib/alarm.ts?t=a')`) agar state `ctx` bersih tiap test. Panggil `unlockAudio()`. Assertion: `ctx.state === 'running'` dan `createBufferSource.callCount >= 1`.
  - Test B: import modul dengan query unik lain, stub AudioContext yang merekam `exponentialRampToValueAtTime`. Panggil `playAlarm()`. Assertion: salah satu argumen `exponentialRampToValueAtTime` sama dengan `ALARM_GAIN` (0.9), dan tidak ada yang melebihi 0.9.

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `node --import tsx --test apps/web/src/lib/alarm.test.ts`
Expected: FAIL (`unlockAudio` bukan fungsi / `ALARM_GAIN` undefined).

- [ ] **Step 3: Implementasi di `apps/web/src/lib/alarm.ts`**

Tambah `export const ALARM_GAIN = 0.9`. Ekspor `unlockAudio(): void`: panggil `audio()`, lalu buat buffer 1 kanal 1 sample dan `AudioBufferSourceNode` dengan gain 0, `start()` segera — semua dalam `try/catch`. Ganti kedua literal `0.4` di `playAlarm` dengan `ALARM_GAIN`. Biarkan `playAlarm` tetap seperti semula (932/699 Hz, 2 atau 4 repetisi).

- [ ] **Step 4: Jalankan ulang test, pastikan lulus**

Run: `node --import tsx --test apps/web/src/lib/alarm.test.ts`
Expected: PASS (2 test).

---

### Task 2: Jembatan volume APK (`lib/seb.ts`)

**Files:**
- Modify: `apps/web/src/lib/seb.ts`
- Create: `apps/web/src/lib/seb.test.ts`

**Interfaces:**
- Consumes: `Window.SebBridge` (deklarasi global yang sudah ada).
- Produces: `export function sebMaximizeVolume(): void` — fire-and-forget, no-op bila bridge tidak ada, tidak pernah melempar.

- [ ] **Step 1: Tulis test gagal** di `apps/web/src/lib/seb.test.ts`:
  - Test A: stub `window.SebBridge = { maximizeVolume: spy }`, panggil `sebMaximizeVolume()`, assertion spy terpanggil 1×.
  - Test B: `window.SebBridge = undefined`, panggil `sebMaximizeVolume()`, assertion tidak melempar.

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `node --import tsx --test apps/web/src/lib/seb.test.ts`
Expected: FAIL (`sebMaximizeVolume` bukan fungsi).

- [ ] **Step 3: Implementasi di `apps/web/src/lib/seb.ts`**

Tambah `maximizeVolume?: () => void` ke deklarasi `Window.SebBridge`. Tambah `sebMaximizeVolume(): void` dengan pola `try/catch` yang sama seperti `sebAlarm`.

- [ ] **Step 4: Jalankan ulang test, pastikan lulus**

Run: `node --import tsx --test apps/web/src/lib/seb.test.ts`
Expected: PASS (2 test).

---

### Task 3: Panggil saat masuk (Login + gate token)

**Files:**
- Modify: `apps/web/src/pages/Login.tsx`
- Modify: `apps/web/src/pages/siswa/SiswaUjian.tsx`
- Modify: `apps/web/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: `unlockAudio()` (Task 1), `sebMaximizeVolume()` (Task 2).

- [ ] **Step 1: Tulis test E2E gagal** di `apps/web/e2e/smoke.spec.ts`:
  - Test `'login membuka audio context'`: `page.addInitScript` membungkus `AudioContext.prototype.createBufferSource` untuk menandai `window.__audioUnlocked = true`; buka `/`, isi NISN/username `guru` dan password `Guru123!`, klik **Masuk**; assertion `page.evaluate(() => window.__audioUnlocked) === true`.
  - Perhatian: gunakan nama field/judul tombol yang persis seperti di `Login.tsx`.

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm run e2e -w @cbt/web -- -g "login membuka audio context"`
Expected: FAIL (flag tidak pernah true).

- [ ] **Step 3: Implementasi call site**

Di `Login.tsx` `onSubmit`, sebelum `await login(...)`, panggil `unlockAudio()` dan `sebMaximizeVolume()`. Di `SiswaUjian.tsx` `start()`, sebelum `apiFetch('/attempts/start', ...)`, panggil `unlockAudio()` dan `sebMaximizeVolume()`. Tambah import yang sesuai. Jangan menambah elemen UI apa pun.

- [ ] **Step 4: Jalankan test E2E dan build/lint**

Run: `npm run e2e -w @cbt/web` lalu `npm run build -w @cbt/web && npm run lint -w @cbt/web`
Expected: E2E hijau (termasuk test baru), build 0 error, lint 0 error.

---

### Task 4: Volume maksimum di APK SEB

**Files:**
- Modify: `apps/seb-android/android/app/src/main/kotlin/id/sch/sman1gorontalo/seb/MainActivity.kt`
- Modify: `apps/seb-android/lib/src/screens/kiosk_screen.dart`
- Create: `apps/seb-android/test/alarm_volume_test.dart`

**Interfaces:**
- Produces: MethodChannel `id.sch.sman1gorontalo.seb/kiosk`, method `maximizeAlarmVolume` → `bool`.
- Produces: `window.SebBridge.maximizeVolume()` mengirim `{ type: 'maximizeVolume' }` ke channel JS `SebBridgeNative`.

- [ ] **Step 1: Tulis test gagal** di `apps/seb-android/test/alarm_volume_test.dart`:
  - Assertion: `kBridgePolyfill` mengandung `maximizeVolume` dan `'maximizeVolume'`.
  - Assertion: konstanta channel kiosk mengandung `id.sch.sman1gorontalo.seb/kiosk`.

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `flutter test test/alarm_volume_test.dart` (workdir `apps/seb-android`)
Expected: FAIL (polyfill belum punya `maximizeVolume`).

- [ ] **Step 3: Implementasi native**

Di `MainActivity.kt` `configureFlutterEngine`, tambah cabang `"maximizeAlarmVolume"`: `val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager`, `setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)`, `result.success(true)`; bungkus `try/catch` dengan `result.success(false)` saat gagal. Jangan sentuh `STREAM_MUSIC`.

- [ ] **Step 4: Implementasi jembatan Dart**

Di `kBridgePolyfill`, tambah `maximizeVolume: function () { SebBridgeNative.postMessage(JSON.stringify({ type: 'maximizeVolume' })); }` dengan `try/catch`. Di `_onBridgeMessage`, sebelum cabang `id`, tambah cabang `payload['type'] == 'maximizeVolume'` yang memanggil `_kioskChannel.invokeMethod('maximizeAlarmVolume')`. Panggil sekali saat WebView siap (`webReady`) lewat method yang sama.

- [ ] **Step 5: Jalankan test dan analyze**

Run: `flutter test test/alarm_volume_test.dart` lalu `flutter analyze` (workdir `apps/seb-android`)
Expected: PASS, tanpa issue baru.

- [ ] **Step 6: Verifikasi perangkat (manual)**

Pasang APK build lokal ke HP uji, buka kiosk, cek level alarm di maksimum dan alarm tetap terdengar saat perangkat di mode senyap. Build signed final tetap dilakukan di mesin yang punya keystore.

---

### Task 5: Sinkron ke folder GitHub

**Files:**
- Modify (copy): seluruh file yang berubah di Task 1–4 ke `E:\Moodle\cbt-sman1-github\...`

**Interfaces:**
- Consumes: hasil Task 1–4.

- [ ] **Step 1: Salin file yang berubah**

Salin: `apps/web/src/lib/alarm.ts`, `apps/web/src/lib/seb.ts`, `apps/web/src/pages/Login.tsx`, `apps/web/src/pages/siswa/SiswaUjian.tsx`, `apps/web/e2e/smoke.spec.ts`, file test baru, `apps/seb-android/...` yang berubah, dan design + plan doc.

- [ ] **Step 2: Verifikasi isi staged**

Run (workdir `E:\Moodle\cbt-sman1-github`): `git add -A; git status --short; git ls-files | Where-Object { $_ -match '(^|/)\.env$|key\.jks|local\.properties' }`
Expected: hanya file yang dimaksud berubah; hasil pencarian Rahasia kosong. **Jangan commit tanpa permintaan eksplisit.**

---

## Self-Review

- Spec coverage: intent, goals, non-goals, anti-goals, constraints, approaches, keputusan web & APK, verifikasi — semua terpetakan ke Task 1–5.
- Step scan: tiap test step punya assertion konkret; tiap code step punya signature/nilai tetap.
- Type consistency: `ALARM_GAIN`, `unlockAudio`, `sebMaximizeVolume`, `maximizeAlarmVolume`, `{type:'maximizeVolume'}` konsisten lintas task.
- Review Focus: 5 butir masing-masing punya test atau langkah verifikasi.
- Proportion: plan lebih pendek dari implementasi; tidak ada body kode penuh.
