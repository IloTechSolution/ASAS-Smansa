# Referensi API — CBT SMAN 1 Gorontalo

| Field | Nilai |
| --- | --- |
| Versi | 1.0 |
| Tanggal | 21 Oktober 2026 |
| Base path | `/api` |
| Format | JSON (kecuali PDF/XLSX/static) |
| Auth | JWT Bearer access token |
| Sumber kode | `apps/api/src/**/*.controller.ts`, `packages/shared/src/schemas.ts` |
| Dokumen terkait | [PRD](./PRD.md) · [ERD](./ERD.md) |

Dokumen ini adalah kontrak HTTP. Perubahan endpoint/body wajib memperbarui file ini.

---

## 1. Base URL

| Lingkungan | URL |
| --- | --- |
| Docker (web + proxy) | `http://localhost:8080/api` |
| Dev API langsung | `http://localhost:3000/api` |
| Dev web Vite | `http://localhost:5173` (proxy ke API) |
| Produksi | `https://<domain>/api` |

Semua path di bawah relatif terhadap base URL. Contoh: `POST /auth/login/admin` → `http://localhost:8080/api/auth/login/admin`.

---

## 2. Autentikasi

### 2.1 Login

`POST /auth/login/:role` — publik. `:role` = `admin|guru|siswa|proktor` (case-insensitive; API menormalisasi ke uppercase).

```json
{ "username": "guru", "password": "Guru123!" }
```

Respons `201`:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "cm...",
    "username": "guru",
    "name": "Guru Contoh",
    "role": "GURU",
    "kelasId": null
  }
}
```

- Role akun harus sama dengan role di path; jika tidak → `401`.
- Pesan gagal selalu generik: `Username/NISN atau password salah`.
- Akun nonaktif → `401`.
- Throttle: maks. **5 gagal** per `(IP, username)` per **5 menit** → `429` dengan sisa detik. Counter di Redis, direset saat login sukses. Env: `LOGIN_MAX_FAILURES`, `LOGIN_WINDOW_SEC`.
- Access token default **15 menit**; refresh default **7 hari** (env `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`).
- Refresh token dirotasi setiap dipakai; token lama langsung hangus.

### 2.2 Header terautentikasi

```http
Authorization: Bearer <accessToken>
```

Access token memuat `{sub, username, name, role, type:"access"}`. Refresh token (`type:"refresh"`) **tidak** diterima untuk REST maupun Socket.io.

### 2.3 Refresh, logout, ganti password

| Method | Path | Akses | Body |
| --- | --- | --- | --- |
| POST | `/auth/refresh` | publik | `{ "refreshToken": "..." }` |
| POST | `/auth/logout` | publik | `{ "refreshToken": "..." }` |
| GET | `/auth/me` | semua login | — |
| POST | `/auth/change-password` | semua login | `{ "currentPassword": "...", "newPassword": "..." }` |

- `refresh` mengembalikan `{accessToken, refreshToken}` baru. Refresh lama hangus (single-use). Reuse → `401`.
- `logout` selalu `{ok:true}` (best-effort).
- Ganti/reset password mencabut semua refresh milik user.

---

## 3. Konvensi

### 3.1 Umum

- Nama field **camelCase**.
- ID berupa string CUID.
- Waktu ISO-8601 UTC, mis. `2026-10-21T13:00:00.000Z`.
- Request body divalidasi Zod; field tak dikenal diabaikan (Zod object default strip).
- Error validasi: `400` dengan pesan `"path: pesan; path: pesan; dan N kesalahan lain"` (maks. 5 detail).
- Kepemilikan data yang tidak cocok → `404` (bukan `403`) untuk menghindari kebocoran keberadaan data.
- Role tidak sesuai → `403`.
- Tanpa/token tidak valid → `401`.
- Konflik status/bisnis → `409`.

### 3.2 Format error

```json
{ "statusCode": 400, "message": "username: Username minimal 3 karakter", "error": "Bad Request" }
```

```json
{ "statusCode": 409, "message": "Sesi sudah ditutup", "error": "Conflict" }
```

`500` hanya untuk kesalahan tak terduga; jangan mengandalkan bentuk pesannya.

### 3.3 Paginasi

Umumnya query `page` (default 1), `limit` (default 20, maks 100), `search`, filter domain. Respons:

```json
{ "data": [], "total": 0, "page": 1, "limit": 20 }
```

Pengecualian: attendance, kartu, monitoring, grading, analytics mengembalikan objek/array domain (lihat masing-masing).

### 3.4 Upload

| Endpoint | Field multipart | Batas |
| --- | --- | --- |
| `POST /questions/:id/image` | `image` | 5 MB; `.jpg/.jpeg/.png/.webp/.gif`; isi byte harus gambar |
| `POST /users/import` | `file` | 5 MB; `.xlsx/.xls`; maks. 2000 baris |

File soal disajikan publik di `/uploads/questions/<file>` (tanpa `/api`). Hapus soal terakhir yang memakai file akan menghapus file dari disk.

### 3.5 Rate limit

- Login: maks. 5 gagal per `(IP, username)` per 5 menit → `429`; sukses mereset counter.
- Verifikasi token ujian: maks. 10 salah per `(sesi, user)` per 5 menit → `429`.
- Endpoint lain belum di-throttle.
- Limit login memakai `req.ip`; API mempercayai `X-Forwarded-For` hanya dari proxy privat (loopback/private network).

---

## 4. Matriks akses ringkas

`A`=ADMIN, `G`=GURU, `P`=PROKTOR, `S`=SISWA, `-`=tidak.

| Modul | A | G | P | S | Catatan |
| --- | --- | --- | --- | --- | --- |
| Auth/akun sendiri | Ya | Ya | Ya | Ya | Login, me, refresh, ganti password |
| Pengguna | Ya | - | - | - | CRUD/import/reset |
| Kelas & mapel (baca) | Ya | Ya | Ya | - | Staf butuh daftar |
| Kelas & mapel (tulis) | Ya | - | - | - | |
| Bank soal | Ya | Ya | - | - | Guru hanya miliknya |
| Ujian | Ya | Ya | - | - | Guru hanya miliknya |
| Sesi (baca) | Ya | Ya | Ya | - | Proktor semua; guru miliknya |
| Sesi (tulis/status) | Ya | Ya | - | - | Guru miliknya |
| Token/absensi/kartu/ekspor | Ya | Ya\* | Ya | - | \*Guru untuk sesi miliknya; token khusus proktor/admin |
| Attempt (kerjakan) | - | - | - | Ya | Hanya attempt sendiri |
| Monitoring & kendali | Ya | - | Ya | - | |
| Penilaian (baca) | Ya | Ya | Ya | - | Proktor read-only |
| Penilaian (tulis/publish) | Ya | Ya | - | - | Guru pemilik ujian |
| Hasil siswa | - | - | - | - | Siswa TIDAK melihat nilai di aplikasi (11 Nov 2026) |
| Settings & audit | Ya | - | - | - | |

---

## 5. Endpoint per modul

### 5.1 Health

| Method | Path | Akses | Keterangan |
| --- | --- | --- | --- |
| GET | `/health` | publik | `{status:"ok"|"degraded", db, redis, time}`; HTTP tetap 200 |

### 5.2 Auth

| Method | Path | Akses | Keterangan |
| --- | --- | --- | --- |
| POST | `/auth/login/:role` | publik | Login |
| GET | `/auth/me` | login | Profil aman (tanpa password) |
| POST | `/auth/refresh` | publik | Rotasi token |
| POST | `/auth/logout` | publik | Cabut refresh |
| POST | `/auth/change-password` | login | Ganti password |

### 5.3 Users (ADMIN)

| Method | Path | Body/query | Keterangan |
| --- | --- | --- | --- |
| GET | `/users` | `page,limit,search,role,kelasId,isActive` | List aman |
| POST | `/users` | `userCreateSchema` | Buat akun |
| GET | `/users/import/template` | — | Unduh template `.xlsx` |
| POST | `/users/import` | multipart `file` | Import per baris |
| GET | `/users/:id` | — | Detail |
| PATCH | `/users/:id` | `name?,role?,nisn?,kelasId?,isActive?` | Username tidak bisa diubah |
| POST | `/users/:id/reset-password` | `{newPassword}` | Cabut sesi user |

`userCreateSchema`:

```json
{
  "username": "guru3",
  "password": "Guru123!",
  "name": "Guru Tiga",
  "role": "GURU",
  "nisn": null,
  "kelasId": null
}
```

Aturan: username 3–32 karakter `[A-Za-z0-9._-]`; password 6–72; nama ≤100. Siswa wajib `nisn` 10 digit, `kelasId`, dan `username === nisn`. Admin tidak bisa menonaktifkan/mengubah role dirinya sendiri.

Import Excel (header): `Username | Password | Nama | Role | NISN | Kelas`. Respons:

```json
{
  "total": 3,
  "success": [{ "row": 2, "username": "0099881100" }],
  "failed": [{ "row": 3, "username": "bad user", "error": "Username hanya huruf, angka, titik, strip, underscore" }]
}
```

### 5.4 Kelas

| Method | Path | Akses | Body/query |
| --- | --- | --- | --- |
| GET | `/kelas` | A/G/P | `?tahunAjaran=2026/2027` |
| GET | `/kelas/tahun-ajaran` | A/G/P | Daftar tahun ajaran |
| POST | `/kelas` | A | `{name,tingkat?,tahunAjaran}` |
| PATCH | `/kelas/:id` | A | field opsional |
| DELETE | `/kelas/:id` | A | Ditolak bila dipakai |

### 5.5 Mapel

| Method | Path | Akses | Body |
| --- | --- | --- | --- |
| GET | `/mapel` | A/G/P | — |
| POST | `/mapel` | A | `{name,code?}` |
| PATCH | `/mapel/:id` | A | field opsional |
| DELETE | `/mapel/:id` | A | Ditolak bila dipakai ujian |

### 5.6 Questions (GURU/ADMIN)

| Method | Path | Keterangan |
| --- | --- | --- |
| GET | `/questions?page&limit&search&type&mine` | Guru melihat miliknya; admin semua (kecuali `mine`) |
| POST | `/questions` | Buat soal (union per tipe) |
| GET | `/questions/:id` | Detail + kunci |
| GET | `/questions/:id/preview` | Detail + `maxScore`, `usageCount` |
| PATCH | `/questions/:id` | Ganti penuh (boleh ganti tipe) |
| POST | `/questions/:id/duplicate` | Salin soal |
| POST | `/questions/:id/image` | Multipart `image` |
| DELETE | `/questions/:id` | Ditolak bila dipakai |

Contoh PG:

```json
{
  "type": "PG",
  "content": "Hasil 3 + 3 adalah ...",
  "weight": 10,
  "scoringMode": "ALL_OR_NOTHING",
  "choices": [
    { "id": "a", "label": "6" },
    { "id": "b", "label": "7" }
  ],
  "correctChoices": ["a"],
  "explanation": "3 + 3 = 6",
  "imageUrl": null
}
```

Tipe & field wajib:

| Tipe | Field wajib | Catatan |
| --- | --- | --- |
| `PG` | `choices` (2–10), `correctChoices` (tepat 1) | `scoringMode` bebas |
| `PG_KOMPLEKS` | `choices`, `correctChoices` (≥1) | Proporsional memakai `hits-wrong` |
| `MATCHING` | `pairs.left`, `pairs.right`, `pairs.mapping` | Tiap kiri wajib punya pasangan |
| `BENAR_SALAH` | `statements[{id,text,answer}]` | |
| `ISIAN_SINGKAT` | `acceptedAnswers` (1–10) | `scoringMode` wajib `ALL_OR_NOTHING` |

`weight` 0.5–100 (default 1). `content` ≤10000. `explanation` ≤5000. `imageUrl` harus hasil upload (`/uploads/...`) atau null.

### 5.7 Exams (GURU/ADMIN)

| Method | Path | Body/query | Keterangan |
| --- | --- | --- | --- |
| GET | `/exams?page&limit&search&mapelId&mine` | — | Guru miliknya; admin semua |
| POST | `/exams` | `{title,description?,mapelId}` | |
| GET | `/exams/:id` | — | Detail + soal + `totalWeight` |
| PATCH | `/exams/:id` | field opsional | |
| PUT | `/exams/:id/questions` | `{questionIds:[...]}` | 1–200, tanpa duplikat; terkunci saat ACTIVE |
| DELETE | `/exams/:id` | — | Ditolak bila punya sesi |

### 5.8 Sessions

| Method | Path | Akses | Body/query |
| --- | --- | --- | --- |
| GET | `/sessions?page&limit&search&examId&hari&visible&mine` | A/G/P | Proktor semua; guru miliknya; `hari` = `SENIN..JUMAT` |
| POST | `/sessions` | A/G | Buat sesi |
| GET | `/sessions/:id` | A/G/P | Detail + soal + bobot |
| PATCH | `/sessions/:id` | A/G/P | Saat tampil: **hanya** `tokenIntervalSec`; tersembunyi: semua field aturan |
| PUT | `/sessions/:id/kelas` | A/G/P | `{kelasIds}`; hanya saat tersembunyi |
| PATCH | `/sessions/:id/visibility` | A/G/P | `{visible: boolean}` — satu-satunya saklar pelaksanaan |
| POST | `/sessions/:id/close` | A/G/P | Tutup & kumpul paksa peserta yang masih mengerjakan |
| PATCH | `/sessions/:id/status` | A/G/P | **Kompatibilitas** — DRAFT/SCHEDULED→sembunyikan, ACTIVE→tampilkan, CLOSED→`close` |
| DELETE | `/sessions/:id` | A/G | Hanya bila belum punya data turunan |

Body buat sesi (model «Hari» — 15 Nov 2026, jadwal tanggal/jam tidak wajib lagi):

```json
{
  "examId": "cm...",
  "title": "UTS Ganjil — XII IPA 1",
  "hariPelaksanaan": "RABU",
  "durationMin": 90,
  "maxViolations": 3,
  "requireSeb": false,
  "shuffleQuestions": true,
  "shuffleOptions": true,
  "kelasIds": ["cm..."]
}
```

Model pelaksanaan (15 Nov 2026): sesi **tersembunyi dari siswa by default**. Hanya
satu saklar: `PATCH /sessions/:id/visibility {visible:true}` — syaratnya ≥1 kelas
peserta + ujian punya ≥1 soal (`startsAt`/`endsAt` tidak lagi diwajibkan). Tampil
⇒ `status='ACTIVE'`; sembunyi ⇒ `status='DRAFT'`. Timer siswa dari `startedAt +
durationMin` (bukan jam sesi). Menutup paksa: `POST /sessions/:id/close` — semua
peserta yang masih mengerjakan dikumpulkan & langsung dinilai.

Sesi yang tersembunyi tidak muncul di `/attempts/available`; siswa yang sudah
mengerjakan (attempt IN_PROGRESS) tetap bisa melanjutkan. Publish nilai cukup
bila semua peserta selesai (tidak lagi butuh status CLOSED).

### 5.9 Settings (ADMIN)

| Method | Path | Body |
| --- | --- | --- |
| GET | `/settings` | — |
| PUT | `/settings` | `{ "key": "TOKEN_DEFAULT_INTERVAL_SEC", "value": "120" }` |

Key: `SCHOOL_NAME`, `APP_NAME`, `TOKEN_DEFAULT_INTERVAL_SEC`, `MAX_VIOLATIONS_DEFAULT`, `REQUIRE_SEB_DEFAULT`, `KKM_DEFAULT`, `TAHUN_AJARAN`. Nilai divalidasi. **Saat ini hanya disimpan; belum diterapkan otomatis** (PRD §10.2).

### 5.10 Audit log (ADMIN)

| Method | Path | Query |
| --- | --- | --- |
| GET | `/audit-logs` | `page,limit,action,entity,actorId` |

Contoh respons:

```json
{
  "data": [
    {
      "id": "cm...",
      "action": "EXAM_CARD_CREATED",
      "entity": "ExamCard",
      "entityId": "cm...",
      "meta": { "serial": "K-..." },
      "createdAt": "2026-10-21T09:00:00.000Z",
      "actor": { "id": "cm...", "username": "proktor", "name": "Proktor Contoh", "role": "PROKTOR" }
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

### 5.11 Token (PROKTOR/ADMIN; verify juga GURU/SISWA)

| Method | Path | Akses | Body |
| --- | --- | --- | --- |
| GET | `/sessions/:id/token/current` | A/P | — |
| POST | `/sessions/:id/token/release` | A/P | `{note?}` |
| POST | `/sessions/:id/token/verify` | semua login | `{token}` |

Contoh respons `current`/`release`:

```json
{
  "sessionId": "cm...",
  "status": "ACTIVE",
  "token": "072514",
  "intervalSec": 120,
  "expiresInSec": 47,
  "serverTime": "2026-10-21T09:00:13.000Z"
}
```

`release` menambahkan `released:true` dan mencatat `TokenAudit`. `verify`:

```json
{ "ok": true, "sessionId": "cm..." }
```

atau `{ "ok": false, "reason": "Token salah atau kedaluwarsa" }`. Terlalu banyak salah → `429`.

### 5.12 Attendance (PROKTOR/ADMIN)

| Method | Path | Body |
| --- | --- | --- |
| GET | `/sessions/:id/attendance` | — |
| PUT | `/sessions/:id/attendance` | `{items:[{userId,status,note?}]}` |

```json
{
  "items": [
    { "userId": "cm...", "status": "HADIR", "note": "Hadir di lab 1" },
    { "userId": "cm...", "status": "IZIN" }
  ]
}
```

Status valid: `HADIR|TERLAMBAT|IZIN|SAKIT|ALPA`. **Jangan kirim `BELUM`** — bukan enum; "belum" = tidak ada baris. Bila `note` tidak dikirim pada update, note lama dipertahankan. Respons sama dengan GET:

```json
{
  "sessionId": "cm...",
  "summary": { "total": 30, "recorded": 12, "HADIR": 10, "IZIN": 2 },
  "data": [
    {
      "user": { "id": "cm...", "username": "005...", "name": "Siswa", "nisn": "005...", "kelas": { "id": "cm...", "name": "XII IPA 1" } },
      "attendance": { "status": "HADIR", "note": "Hadir di lab 1", "checkedInAt": "...", "checkedInBy": { "id": "cm...", "name": "Proktor" } }
    }
  ]
}
```

### 5.13 Readiness — DIHAPUS (15 Nov 2026)

Modul checklist lab readiness telah dihapus dari aplikasi (model, endpoint, UI, ekspor Excel). Route readiness mengembalikan **404** untuk semua role. Daftar hadir & pelaksanaan dilakukan lewat panel Pelaksanaan dan absensi PDF/XLSX.

### 5.14 Kartu Login (PROKTOR/ADMIN) — menggantikan "Kartu peserta" per-sesi

| Method | Path | Body | Keterangan |
| --- | --- | --- | --- |
| GET | `/kartu/count` | — | Jumlah siswa aktif (filter `?kelasId`) |
| GET | `/kartu/pdf` | — | PDF A4, 8 kartu per halaman (`?kelasId`, `?judul` judul acara manual) |

Kartu universal (satu per siswa, berlaku untuk semua ujian): berisi logo/wordmark sekolah, judul acara, TA, QR (`WEB_URL`), nama, kelas, username (NISN), **password awal** (kolom internal `initialPassword` — hanya bisa dibaca server & dicetak terenkripsi at-rest), dan ruang ujian (`Kelas.ruang`). Blok "Kepala Sekolah" memakai gambar ttd/stempel yang diunggah admin.

### 5.15 Ekspor (PROKTOR/ADMIN)

| Method | Path | Isi |
| --- | --- | --- |
| GET | `/sessions/:id/export/absensi` | XLSX absensi + ringkasan |
| GET | `/sessions/:id/export/absensi/pdf` | PDF daftar hadir (kolom tanda tangan) |
| GET | `/sessions/:id/export/nilai` | XLSX nilai + ketuntasan KKM |
| GET | `/sessions/:id/export/ringkasan` | XLSX peserta + kehadiran |

Semua mengembalikan berkas (`Content-Disposition: attachment`). Sesi tidak dikenal → `404`.

### 5.16 Attempts (SISWA)

| Method | Path | Body | Keterangan |
| --- | --- | --- | --- |
| GET | `/attempts/available` | — | Sesi kelasnya + attempt sendiri |
| POST | `/attempts/start` | `{sessionId,token,seb?}` | Gate lengkap; header SEB wajib bila `requireSeb` |
| GET | `/attempts/:id` | — | State + soal + jawaban; header SEB wajib bila `requireSeb` |
| PUT | `/attempts/:id/answers` | `{questionId,payload?,isFlagged?}` | Autosave |
| POST | `/attempts/:id/submit` | `{reason?}` | `MANUAL|TIMEOUT|FORCED` |
| POST | `/attempts/:id/integrity` | `{type,detail?}` | Catat pelanggaran |

#### Verifikasi Safe Exam Browser

Untuk sesi `requireSeb=true`, **semua** endpoint attempt di atas (kecuali `available`) wajib menyertakan header yang dipasang otomatis oleh SEB:

```http
X-SafeExamBrowser-RequestHash: <sha256(URL absolut + Browser Exam Key)>
```

- URL absolut dihitung API dari `x-forwarded-proto`/`req.protocol` + `X-Forwarded-Host`/`Host` + `originalUrl` (proto dari header dulu, karena `trust proxy` tidak mencakup seluruh range IP Docker); nginx wajib meneruskan `Host`/`X-Forwarded-Host` **termasuk port** beserta `X-Forwarded-Proto`.
- Key server dari env `SEB_BROWSER_EXAM_KEY` (boleh beberapa key dipisah koma).
- Field body `seb` hanya advisory dan **tidak** dipakai untuk gate.
- Key belum diset + sesi wajib SEB → `503`; hash salah/tidak ada → `400`.
- Berlaku juga untuk `GET` state, autosave, submit, dan integritas, sehingga token sesi tidak bisa dipindah ke browser biasa setelah start.

**Uji konfigurasi tanpa login (untuk APK/klien SEB):** `GET /api/seb/self-test` — publik; menghitung hash-nya sendiri dari header yang dikirim klien. `200 { ok: true, fingerprints: [...] }` bila key cocok; `400 { ok: false, status: 'HASH_MISMATCH' }` bila tidak; `503` bila `SEB_BROWSER_EXAM_KEY` server kosong. `fingerprints` = 8 hex pertama dari SHA256 tiap key server (bukan key-nya). Dipakai operator APK ("Uji key ke server" di mode operator).

**Verifikasi PIN keluar APK (mode operator → "Keluar aplikasi"):** `POST /api/seb/exit-verify` — publik (tanpa JWT) `{ pin: "4–8 angka", school?: "slug|id" }`. PIN diatur per sekolah oleh admin di Pengaturan ("PIN Keluar APK SEB") dan disimpan sebagai SHA-256 hex di `GlobalConfig.SEB_EXIT_PIN` — tidak pernah dikembalikan ke klien (bukan lewat `/api/settings` maupun generik upsert). Response: `200 { ok: true }` (APK boleh menutup), `200 { ok: false, configured: true }` (PIN salah), `200 { ok: false, configured: false }` (admin belum mengatur — tombol keluar dinonaktifkan). Salah ≥ 10 kali per sekolah+IP dalam 5 menit → `429`. `school` kosong = sekolah default (`sman1`). Perbandingan hash constant-time. Rate-limit memakai Redis (`sebpinfail:{schoolId}:{ip}`).

**Kelola PIN keluar APK (ADMIN, terkunci ke sekolah terpilih; audit `SEB_EXIT_PIN_SET` / `SEB_EXIT_PIN_CLEAR`):**
- `GET /api/settings/seb-exit-pin` → `{ configured: boolean, updatedAt: string|null }` (tanpa hash).
- `PUT /api/settings/seb-exit-pin` body `{ pin: "4–8 angka" }` → simpan/ganti (disimpan SHA-256).
- `DELETE /api/settings/seb-exit-pin` → hapus (tombol keluar di APK dinonaktifkan).


**Klien SEB Android (APK kiosk kustom, `docs/SEB-ANDROID.md`):** webapp menandatangani semua request `/api` bila ada `window.SebBridge` (polyfill diinjeksikan APK setelah halaman selesai dimuat; native menghitung `SHA256(URL+key)`; web mengirim header secara otomatis). Web yang berjalan di browser biasa tidak mengirim header ini. Pindah ke background di APK tercatat sebagai `WINDOW_BLUR` (sumber `apphidden`).

Respons `start`/`state` (diringkas):

```json
{
  "attempt": {
    "id": "cm...",
    "status": "IN_PROGRESS",
    "startedAt": "2026-10-21T09:00:00.000Z",
    "expiresAt": "2026-10-21T10:30:00.000Z",
    "submittedAt": null,
    "violationCount": 0,
    "sebVerified": false,
    "score": null
  },
  "session": {
    "id": "cm...",
    "title": "UTS — XII IPA 1",
    "exam": { "id": "cm...", "title": "UTS Matematika" },
    "mapel": "Matematika",
    "durationMin": 90,
    "maxViolations": 3,
    "requireSeb": false,
    "shuffleQuestions": true,
    "shuffleOptions": true,
    "resultsPublished": false
  },
  "questions": [
    {
      "id": "cm...",
      "type": "PG",
      "content": "Hasil 3 + 3 ...",
      "imageUrl": null,
      "weight": 10,
      "scoringMode": "ALL_OR_NOTHING",
      "choices": [{ "id": "a", "label": "6" }, { "id": "b", "label": "7" }]
    }
  ],
  "answers": [{ "questionId": "cm...", "payload": "a", "isFlagged": false }],
  "serverTime": "2026-10-21T09:05:00.000Z",
  "remainingSec": 5100
}
```

Catatan:
- Kunci jawaban, pembahasan, dan skor **tidak** ada di state sebelum publish.
- Soal `BENAR_SALAH` dikirim tanpa `answer`; matching tanpa `mapping`; isian tanpa kunci.
- Payload autosave divalidasi terhadap tipe soal dan ID opsi yang ada.
- `isFlagged` boleh dikirim tanpa `payload`; jawaban lama tidak tertimpa.
- Start kedua (termasuk paralel) mengembalikan attempt yang sama.
- `sebVerified:true` hanya diberikan bila hash SEB valid; laporan `seb:true` dari klien tidak lagi menaikkan flag ini.

Contoh autosave:

```json
{ "questionId": "cm...", "payload": ["a", "c"], "isFlagged": true }
```

Contoh submit: `{ "reason": "MANUAL" }` (default `MANUAL`).

Integritas:

```json
{ "type": "TAB_SWITCH", "detail": { "hidden": true } }
```

Respons: `{ violationCount, maxViolations, locked, forcedSubmitted }`.
**Batas pelanggaran TIDAK lagi mengumpulkan paksa** — attempt dikunci
(`locked: true`, status tetap IN_PROGRESS, jawaban aman). Semua mutasi
(autosave/submit/integrity) ditolak `423` selama terkunci. Membuka kembali
harus dengan token sesi proktor: `POST /api/attempts/:id/unlock` body
`{ "token": "123456" }` — memverifikasi TOTP sesi yang sama dengan gerbang
start (rate-limit 10 salah / 5 menit → `429`), lalu mengembalikan state
penuh (`locked: false`). Attempt terlocked tidak mengirim soal/jawaban dari
`GET /attempts/:id` (payload minimal `{ locked: true, attempt, session }`).

```json
{ "message": "Ujian terkunci — minta token kepada proktor untuk membuka kembali", "code": "ATTEMPT_LOCKED" }
```

### 5.17 Monitoring (PROKTOR/ADMIN)

| Method | Path | Body | Keterangan |
| --- | --- | --- | --- |
| GET | `/sessions/:id/monitoring` | — | Snapshot papan |
| POST | `/sessions/:id/monitoring/refresh` | — | Broadcast ulang snapshot |
| POST | `/attempts/:id/warn` | `{message}` | Peringatan + integritas OTHER |
| POST | `/attempts/:id/extend` | `{minutes,note?}` | 1–120 menit |
| POST | `/attempts/:id/force-submit` | — | Kumpulkan + nilai |


Bentuk papan:

```json
{
  "sessionId": "cm...",
  "session": { "title": "UTS", "status": "ACTIVE", "durationMin": 90, "maxViolations": 3 },
  "questionCount": 20,
  "serverTime": "...",
  "summary": { "total": 30, "inProgress": 25, "submitted": 4, "expired": 0, "forced": 1 },
  "data": [
    {
      "attempt": { "id": "cm...", "status": "IN_PROGRESS", "expiresAt": "...", "submittedAt": null, "violationCount": 1 },
      "user": { "id": "cm...", "name": "Siswa", "username": "005...", "nisn": "005...", "kelas": { "name": "XII IPA 1" } },
      "answeredCount": 5,
      "questionCount": 20,
      "remainingSec": 3200,
      "online": true,
      "lastSeenAt": "2026-10-21T09:05:00.000Z"
    }
  ]
}
```

### 5.17b Presence — Siswa Online (PROKTOR/ADMIN; ping SISWA)

Presence app-level (bukan DB login): siswa "online" selama membuka aplikasi
(app shell ping tiap 45 dtk) atau berada di ruang ujian (heartbeat 25 dtk,
iut menandai). Dipakai halaman **Siswa Online** di web (`/app/kehadiran`).

| Method | Path | Body | Keterangan |
| --- | --- | --- | --- |
| POST | `/presence/ping` | `{}` | SISWA — tandai online (dipanggil app shell + heartbeat socket) |
| GET | `/presence/siswa` | `?recent=true\|false` | PROKTOR/ADMIN — daftar online + baru keluar (≤15 mnt; `recent=false` hanya yang online) |

Bentuk respons:

```json
{
  "serverTime": "2026-11-14T17:04:37.512Z",
  "onlineCount": 24,
  "inExamCount": 18,
  "recentCount": 3,
  "data": [
    {
      "id": "cm...", "name": "Siswa Contoh", "username": "0051234567", "nisn": "0051234567",
      "kelas": { "name": "XII IPA 1" },
      "lastSeenAt": "2026-11-14T17:04:37.512Z",
      "online": true,
      "inExam": { "sessionId": "cm...", "title": "UTS" } | null
    }
  ]
}
```

Disimpan di Redis ZSET `presence:siswa` (member = userId, score = ms),
dibersihkan otomatis (>6 jam). Tidak merekam isi jawaban/aktivitas klik.


`online` = heartbeat < 90 detik. UI polling 15 detik sebagai jaring pengaman.

### 5.18 Integrity (PROKTOR/ADMIN)

| Method | Path | Keterangan |
| --- | --- | --- |
| GET | `/sessions/:id/integrity` | Riwayat pelanggaran semua attempt sesi |

### 5.19 Grading

| Method | Path | Akses | Keterangan |
| --- | --- | --- | --- |
| GET | `/sessions/:id/grading` | A/G | Ringkasan skor + progres + review tertunda |
| GET | `/sessions/:id/export/nilai` | A/G | Excel rekap nilai — **409 selama masih ada isian menunggu review**; inilah cara nilai dibagikan ke siswa |
| POST | `/sessions/:id/grade` | A/G | Nilai ulang attempt selesai |
| GET | `/sessions/:id/reviews` | A/G | Isian singkat perlu review |
| GET | `/sessions/:id/results` | A/G | Hasil per peserta + rincian butir |
| GET | `/sessions/:id/item-analysis` | A/G | Kesulitan, daya pembeda, pengecoh |
| POST | `/sessions/:id/publish` | A/G | `{published:true|false}` |
| POST | `/attempts/:id/review` | A/G | `{questionId,score,note?}` |

`/attempts/:id/result` **DIHAPUS (11 Nov 2026)** — siswa tidak melihat nilai/kunci/pembahasan di aplikasi.

`publish:true` hanya bila tidak ada attempt `IN_PROGRESS` (semua peserta selesai/expired) dan tidak ada review tertunda — status sesi tidak lagi dipakai sebagai prasyarat. `score` review 0..bobot soal.

Contoh review:

```json
{ "questionId": "cm...", "score": 5, "note": "Jawaban ekuivalen" }
```

### 5.20 Analytics

| Method | Path | Akses | Keterangan |
| --- | --- | --- | --- |
| GET | `/exams/:id/analytics` | A/G/P | Statistik ujian; guru hanya ujian sendiri |

### 5.21 Certificate — DIHAPUS (11 Nov 2026)

BA Digital / sertifikat PDF dihapus sepenuhnya (UI, endpoint, verifikasi publik QR). `GET /exams/:id/certificate` kini `404`.

---

## 6. Socket.io — monitoring realtime

| Item | Nilai |
| --- | --- |
| Namespace | `/monitoring` |
| URL | `http://localhost:8080` (Docker) / `http://localhost:3000` (dev) |
| Auth | `{ auth: { token: "<accessToken>" } }` |
| Transport | websocket/polling |

### 6.1 Event dari klien

| Event | Payload | Ack | Siapa |
| --- | --- | --- | --- |
| `monitor:join` | `sessionId` | `{ok:true,room}` / `{ok:false,error}` | PROKTOR/ADMIN |
| `attempt:join` | `attemptId` | `{ok:true,room}` / `{ok:false,error}` | SISWA pemilik attempt |
| `attempt:heartbeat` | `attemptId` | `{ok:true}` | SISWA pemilik attempt |

### 6.2 Event dari server

| Event | Payload | Penerima |
| --- | --- | --- |
| `monitor:snapshot` | Objek papan yang sama dengan REST monitoring | Ruang `session:<id>` |
| `monitor:activity` | `{sessionId,attemptId,kind,at}` | Ruang `session:<id>` |
| `warn` | `{message,from}` | Ruang `attempt:<id>` |
| `attempt:control` | `{type:"extend",attemptId,expiresAt,reason?}` atau `{type:"force-submit",attemptId,submittedAt,reason?}` | Ruang `attempt:<id>` |

Token palsu/refresh token → koneksi diputus. Siswa tidak boleh join ruang monitor; proktor tidak boleh join ruang attempt orang lain.

Contoh klien:

```ts
import { io } from 'socket.io-client';
const socket = io('/monitoring', { auth: { token: accessToken }, transports: ['websocket'] });
socket.emit('monitor:join', sessionId, (res) => console.log(res));
socket.on('monitor:snapshot', (board) => console.log(board));
```

---

## 7. Kode status & error umum

| Status | Arti | Contoh |
| --- | --- | --- |
| 200 | OK | GET/PATCH/PUT |
| 201 | Dibuat | POST create/login/generate |
| 400 | Validasi/bisnis input | Zod, token salah, status absensi invalid |
| 401 | Belum/tidak valid login | Token absen/kedaluwarsa, refresh reuse |
| 403 | Role tidak berhak | Siswa akses monitoring |
| 404 | Tidak ada / bukan milik | Sesi/attempt/soal lain |
| 409 | Konflik state | Sesi sudah ditutup, masih IN_PROGRESS, duplikat |
| 429 | Terlalu banyak percobaan | 5 login gagal/5 menit, 10 token salah/5 menit |
| 500 | Bug tak terduga | Laporkan dengan log |
| 503 | Layanan belum siap | Sesi wajib SEB tetapi `SEB_BROWSER_EXAM_KEY` kosong |

Contoh pesan khas:

- `Terlalu banyak percobaan login. Coba lagi dalam 287 detik.`
- `Verifikasi Safe Exam Browser gagal — buka ujian melalui SEB dengan konfigurasi yang benar`
- `Verifikasi Safe Exam Browser belum dikonfigurasi di server — hubungi administrator`
- `Token salah atau kedaluwarsa — minta token terbaru ke proktor`
- `Sesi belum aktif — minta proktor mengaktifkan sesi`
- `Anda tidak terdaftar sebagai peserta sesi ini`
- `Ujian sudah selesai — jawaban tidak bisa disimpan`
- `Tutup sesi dulu (status CLOSED) sebelum menerbitkan hasil`
- `Masih ada N jawaban isian singkat yang perlu direview manual`

---

## 8. Batasan kontrak saat ini

1. ~~QR sertifikat belum dapat diverifikasi publik (P1)~~ — QR sertifikat sudah diverifikasi publik via `GET /api/verify/:token` (HMAC-SHA256, 7 Nov 2026).
2. ~~Readiness~~ — modul readiness dihapus 15 Nov 2026; tidak menjadi gate apa pun.
3. ~~Sesi CLOSED tidak menghentikan attempt berjalan~~ — Tutup sesi kini force-submit attempt berjalan (15 Nov 2026).
4. ~~Settings belum diterapkan~~ — konfigurasi global kini dipakai (app-config, 7 Nov 2026): tokenIntervalSec/maxViolations/requireSeb default sesi, KKM default mapel, TAHUN_AJARAN, brand publik.
5. `BELUM` bukan status absensi yang valid (desain) — mengirim `BELUM` justru *mengosongkan* absensi peserta.
6. `POST /sessions/:id/kartu/generate` wajib `userId`; tidak ada fallback ke aktor.
7. List dibatasi `limit ≤ 100`.
8. Socket.io satu instance; multi-instance butuh adapter Redis.
9. Verifikasi SEB bergantung pada Browser Exam Key di klien; key yang bocor dapat dipakai ulang selama URL sama. Wajib HTTPS dan rotasi key bila dicurigai bocor.
10. Throttle login memakai IP dari proxy; bila API diekspos langsung tanpa proxy, `X-Forwarded-For` tidak dipercaya (aman), tetapi IP klien dilihat dari koneksi TCP.

---

## 9. Riwayat perubahan audit (21 Okt 2026)

| Perubahan | Dampak kontrak |
| --- | --- |
| Absensi: UI tidak lagi mengirim `BELUM`; note tidak dikirim = dipertahankan | Tidak ada breaking API; perilaku update note lebih aman |
| Kartu: alokasi serial bebas saat bentrok | `serial` tetap unik; bisa bukan urutan roster |
| Import Excel: validasi penuh | Baris invalid sekarang masuk `failed`, bukan `success` |
| `start` paralel: P2002 ditangani | Keduanya `201` dengan attempt sama |
| `kartu/generate` tanpa `userId` | Sekarang `400` (sebelumnya 404 membingungkan) |
| `export/kartu` sesi tak dikenal | Sekarang `404` |
| Filter Zod | Pesan 400 dibatasi 5 detail + ringkasan |
| Monitoring UI | Polling 15 detik (tidak mengubah API) |
| Login | Maks. 5 gagal per IP+username/5 menit → `429`; sukses mereset |
| SEB | Tag `seb` di body tidak lagi menjadi gate; wajib `X-SafeExamBrowser-RequestHash` valid pada sesi `requireSeb` |
