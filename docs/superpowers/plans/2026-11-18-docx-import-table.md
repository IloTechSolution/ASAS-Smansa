# Template Import DOCX Berbasis Tabel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Template Word import soal memakai tabel `Label | Isian` yang rapi (termasuk baris Bobot), dan parser tetap menerima format lama.

**Architecture:** Generator DOCX (`docx`) membuat lima tabel contoh, satu per tipe soal. Parser baru membaca HTML dari `mammoth.convertToHtml()` dan mengubah baris tabel menjadi record yang sama dengan format Excel/parser lama; bila tidak ada tabel, `importDocx` jatuh ke `parseDocxQuestions()` lama. Tidak ada dependensi baru.

**Tech Stack:** TypeScript (NestJS), `docx`, `mammoth`, `node:test` + `tsx`, Playwright (`request` fixture).

**Spec:** `docs/superpowers/specs/2026-11-18-docx-import-table-design.md`

## Global Constraints

- Label ramah guru: `Teks soal`, `Jawaban A` … `Jawaban D`, `Bobot`, `Kunci`, `Pembahasan`, `Kiri`, `Kanan`, `Pernyataan`, `KunciIsian`, `Mode Skor`.
- Setiap tabel contoh wajib memuat baris `Bobot`.
- Parser menghasilkan kunci record persis: `Tipe`, `Konten`, `Bobot`, `Opsi`, `Kunci`, `KunciIsian`, `Kiri`, `Kanan`, `Pernyataan`, `Pembahasan`, `Mode Skor`, `__row`.
- `Opsi` dirakit dari `Jawaban A`…`Jawaban D` menjadi `A|teks;B|teks;…`.
- Tabel tanpa baris `Tipe` dilewati.
- Format DOCX lama `SOAL <n>` harus tetap diimpor (fallback).
- Tanpa dependensi npm baru. Repo sumber `E:\Moodle\Moodle` bukan git — commit tidak dimasukkan; folder rilis `E:\Moodle\cbt-sman1-github` di-stage di Task 4.

## Review Focus

1. Label ditulis dengan spasi/kapital berbeda (`TEKS SOAL`, `jawaban a`) → tetap dikenali. Test: Task 1 `normalizeDocxKey` + tabel campuran.
2. Baris `Bobot` bernilai `0,5` atau kosong → `0,5` terbaca utuh; kosong dibiarkan sehingga `parseImportRow` pakai default 1. Test: Task 1.
3. Tabel petunjuk/legenda ikut terbaca → harus dilewati (tidak menghasilkan soal sampah). Test: Task 1 tabel tanpa `Tipe`.
4. DOCX format lama tanpa tabel → harus fallback ke parser lama, bukan error. Test: Task 1 (`[]` untuk HTML tanpa tabel) + Task 3 wiring.
5. Template hasil generator diunduh lalu diunggah ulang → 5 soal berhasil dengan bobot. Test: Task 3 E2E.

---

### Task 1: Parser tabel DOCX murni

**Files:**
- Create: `apps/api/src/questions/docx-tables.ts`
- Test: `apps/api/src/questions/docx-tables.test.ts`

**Interfaces:**
- Produces: `export function normalizeDocxKey(k: string): string`
- Produces: `export function parseDocxTables(html: string): Array<Record<string, unknown>>` — mengembalikan `[]` bila tidak ada tabel yang valid.

- [ ] **Step 1: Tulis test gagal** di `apps/api/src/questions/docx-tables.test.ts` dengan `node:test`. HTML contoh memakai bentuk mammoth: `<table><tr><td><p>Tipe</p></td><td><p>PG</p></td></tr>…</table>`.
  - `parseDocxTables` tabel PG → `{ Tipe:'PG', Konten:'Ibu kota Indonesia?', Bobot:'1', Opsi:'A|Jakarta;B|Bandung;C|Surabaya;D|Medan', Kunci:'A', __row:'SOAL 1' }`.
  - Label ditulis `TEKS SOAL` dan `jawaban a` → tetap dipetakan (`Konten`, `Opsi`).
  - Tabel tanpa baris `Tipe` → diabaikan (hasil `[]`).
  - Tabel MATCHING → `Kiri` dan `Kanan` terbaca.
  - Tabel ISIAN_SINGKAT → `KunciIsian` terbaca.
  - HTML tanpa `<table>` → `[]`.
  - `Bobot` bernilai `0,5` → terbaca utuh sebagai `'0,5'`.

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `node --import tsx --test apps/api/src/questions/docx-tables.test.ts`
Expected: FAIL (`docx-tables.ts` tidak ditemukan).

- [ ] **Step 3: Implementasi `apps/api/src/questions/docx-tables.ts`**

`normalizeDocxKey`: salin pemetaan yang ada di `questions.service.ts`, tambah `teks soal` → `Konten`, `jawaban` → `Opsi`, `bobot` → `Bobot`. `parseDocxTables`: regex ambil blok `<table>…</table>`, tiap `<tr>` → sel `<td>/<th>`, buang tag, dekode entity dasar, `.trim()`. Baris 2 sel: sel pertama = label, kedua = nilai. `jawaban <huruf>` dikumpulkan ke array choices; label lain masuk record via `normalizeDocxKey`. Judul `SOAL n` dari baris bukan-2-sel dipakai untuk `__row`, default `SOAL <index+1>`. Soal tanpa `Tipe` dibuang. Bila choices tidak kosong, tambah `Opsi = choices.map(c => \`${c.id}|${c.label}\`).join(';')`.

- [ ] **Step 4: Jalankan ulang test, pastikan lulus**

Run: `node --import tsx --test apps/api/src/questions/docx-tables.test.ts`
Expected: PASS (7 test).

---

### Task 2: Generator template tabel

**Files:**
- Modify: `apps/api/src/questions/question-templates.ts` (bagian `buildDocxTemplate`, `DOCX_EXAMPLES`, helper `cell`)
- Test: `apps/api/src/questions/docx-template.test.ts`

**Interfaces:**
- Consumes: `parseDocxTables` (Task 1), `buildDocxTemplate` (existing).
- Produces: DOCX dengan 5 tabel; tiap tabel punya baris `Tipe`, `Teks soal`, `Bobot`, `Mode Skor`, `Pembahasan` + baris khusus tipe.

- [ ] **Step 1: Tulis test gagal** di `apps/api/src/questions/docx-template.test.ts`:
  - `const buf = await buildDocxTemplate(); const html = (await mammoth.convertToHtml({ buffer: buf })).value; const rows = parseDocxTables(html);`
  - Assertion: `rows.length === 5`; tiap row punya kunci `Tipe`, `Konten`, `Bobot`; `rows.map(r => r.Tipe)` sama dengan `['PG','PG_KOMPLEKS','MATCHING','BENAR_SALAH','ISIAN_SINGKAT']`; `rows[0].Opsi` diawali `A|Jakarta`.

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `node --import tsx --test apps/api/src/questions/docx-template.test.ts`
Expected: FAIL (template masih berupa paragraf, `parseDocxTables` hasil `[]`).

- [ ] **Step 3: Implementasi template**

Tulis ulang `buildDocxTemplate`: paragraf judul + petunjuk singkat (5 bullet), lalu untuk tiap `DOCX_EXAMPLES` satu `Table` 2 kolom. Baris pertama = judul `SOAL n · TIPE` (2 sel di-merge, isi `103556`, teks putih bold). Helper `cell(text, {bold?, fill?, span?})` menghasilkan `TableCell` dengan border tipis, lebar 32%/68%, `shading` untuk label. Tambah paragraf kosong antar tabel. Hapus tabel legenda "Kolom yang dikenal" dan blok contoh paragraf lama. Nilai `Bobot` contoh = `1` pada kelima tabel.

- [ ] **Step 4: Jalankan ulang test, pastikan lulus**

Run: `node --import tsx --test apps/api/src/questions/docx-template.test.ts`
Expected: PASS (1 test).

---

### Task 3: Pasang parser ke `importDocx` + fallback

**Files:**
- Modify: `apps/api/src/questions/questions.service.ts` (`importDocx`, hapus `normalizeDocxKey` private, import helper)
- Modify: `apps/web/e2e/smoke.spec.ts` (test integrasi unduh→unggah)

**Interfaces:**
- Consumes: `parseDocxTables`, `normalizeDocxKey` (Task 1), template (Task 2).

- [ ] **Step 1: Tulis test integrasi gagal** di `apps/web/e2e/smoke.spec.ts`:
  - Test `'template DOCX tabel bisa diimpor ulang jadi 5 soal'`: buat `request.newContext({ baseURL:'http://localhost:8080' })`, login `POST /api/auth/login/guru` (`guru`/`Guru123!`), ambil header `Authorization`.
  - `GET /api/questions/import/template-docx` → `body()` sebagai Buffer.
  - `POST /api/questions/import` dengan `multipart: { file: { name:'template.docx', mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer } }`.
  - Assertion: respons `total === 5`, `success.length === 5`, `failed.length === 0`; lalu `DELETE /api/questions/:id` untuk semua id hasil dan `api.dispose()`.

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm run e2e -w @cbt/web -- -g "template DOCX tabel bisa diimpor ulang"`
Expected: FAIL (parser lama tidak membaca tabel → 400 "Dokumen tidak berisi baris SOAL").

- [ ] **Step 3: Implementasi `importDocx`**

Di `apps/api/src/questions/questions.service.ts`, import `parseDocxTables`, `normalizeDocxKey` dari `./docx-tables`. `importDocx`: lakukan `mammoth.convertToHtml({ buffer })` → `parseDocxTables(html)`; bila `rows.length > 0` pakai rows itu; bila `0`, jalankan `mammoth.extractRawText({ buffer })` lalu `parseDocxQuestions(text)` seperti lama. Pertahankan batas 500 dan `label` dari `__row`. Hapus method `normalizeDocxKey` private dan ganti pemanggilannya di `parseDocxQuestions` menjadi fungsi import.

- [ ] **Step 4: Jalankan test integrasi + build + seluruh E2E**

Run: `npm run e2e -w @cbt/web` lalu `npm run build -w @cbt/api`
Expected: E2E hijau termasuk test baru; build api 0 error.

---

### Task 4: Sinkron ke folder GitHub

**Files:**
- Copy: `apps/api/src/questions/docx-tables.ts`, `docx-tables.test.ts`, `docx-template.test.ts`, `question-templates.ts`, `questions.service.ts`, `apps/web/e2e/smoke.spec.ts`, design + plan doc.

**Interfaces:**
- Consumes: hasil Task 1–3.

- [ ] **Step 1: Salin dan stage**

Salin file di atas ke `E:\Moodle\cbt-sman1-github\...`, lalu `git add -A`.
Expected: `git status --short` menampilkan file yang dimaksud; pencarian `.env`/keystore kosong. **Jangan commit tanpa permintaan eksplisit.**

---

## Self-Review

- Spec coverage: intent, goals, non-goals, anti-goals, constraints, approaches, keputusan template & parser, test, verifikasi — terpetakan ke Task 1–4.
- Step scan: tiap test step punya assertion konkret; tiap code step punya signature/nilai tetap.
- Type consistency: `parseDocxTables`, `normalizeDocxKey`, `Opsi`, `__row`, `Bobot` konsisten di semua task.
- Review Focus: 5 butir masing-masing punya test di Task 1/2/3.
- Proportion: plan lebih pendek dari kode yang dihasilkan; tidak ada transkrip implementasi penuh.
