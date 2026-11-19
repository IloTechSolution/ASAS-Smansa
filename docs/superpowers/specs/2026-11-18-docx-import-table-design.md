# Design: Template import soal DOCX berbasis tabel

Tanggal: 2026-11-18 · Status: **menunggu persetujuan**

## Intent / why

Guru mengisi template Word. Format lama berupa blok `SOAL 1` dengan baris
`Tipe: … / Konten: … / Opsi: A|Jakarta;B|…` menyulitkan guru membedakan mana
teks soal dan mana jawaban. Guru meminta tabel yang rapi, dengan baris
`Teks soal`, `Jawaban A/B/C/D`, **`Bobot`**, dan `Kunci`.

## Goals

- Template DOCX berisi satu tabel contoh per tipe soal, mudah diisi di Word.
- Setiap tabel memiliki baris **Bobot**.
- Guru tinggal mengetik di kolom kanan; kolom kiri sudah berlabel.
- Format DOCX lama (`SOAL <n>`) tetap bisa diimpor.
- Tidak menambah dependensi npm.

## Non-goals

- Mengubah template Excel atau parser Excel.
- Menambah dukungan gambar lewat DOCX (gambar tetap diisi manual setelah soal tersimpan).

## Anti-goals

- Tabel terlalu lebar/penuh sehingga sulit dibaca di Word.
- Tabel penjelasan ikut terbaca sebagai soal, menghasilkan impor sampah.

## Constraints

- `mammoth.extractRawText()` meratakan sel tabel menjadi baris teks — harus beralih ke `convertToHtml()` untuk membaca struktur tabel.
- Parser lama `parseDocxQuestions()` harus tetap dipakai sebagai fallback.
- `parseImportRow()` menerima record dengan kunci `Tipe`, `Konten`, `Bobot`, `Opsi`, `Kunci`, … — parser tabel harus menghasilkan bentuk yang sama persis.

## Approaches

1. **Tabel 2 kolom per soal (dipilih)** — `Label | Isian`, satu tabel per contoh soal. Enak dibaca di A4 potret, semua tipe ter-cover, gampang diisi.
2. **Satu tabel besar, 1 baris = 1 soal** — lebih ringkas untuk banyak soal, tapi perlu landscape dan kolom sempit; tipe non-PG butuh kolom tambahan.
3. **Tabel per tipe soal** — paling rapi per kasus, paling banyak kode parser.

## Keputusan implementasi

**Template — `apps/api/src/questions/question-templates.ts`**

- `buildDocxTemplate()`: judul + petunjuk singkat + 5 tabel contoh (PG, PG_KOMPLEKS, MATCHING, BENAR_SALAH, ISIAN_SINGKAT) + satu paragraf kosong antar tabel.
- Header tiap tabel: satu baris `SOAL 1 · PG` (2 sel di-merge, isi navy, teks putih, bold).
- Kolom kiri = label (lebar ~32%, isi abu muda, bold, warna navy); kolom kanan = contoh isian (lebar ~68%, putih). Border tipis, tinggi baris 22–26 pt.
- Baris umum di semua tabel: `Tipe`, `Teks soal`, `Bobot`, `Mode Skor`, `Pembahasan`.
- Baris khusus: PG/PG_KOMPLEKS `Jawaban A`–`Jawaban D` + `Kunci`; MATCHING `Kiri` + `Kanan`; BENAR_SALAH `Pernyataan`; ISIAN_SINGKAT `KunciIsian`.
- Nilai contoh diberi penanda "(contoh — ganti dengan soal Anda)" di petunjuk, bukan di setiap sel.
- Tabel legenda lama dihapus (label sudah ada di setiap tabel).

**Parser — `apps/api/src/questions/questions.service.ts` + helper baru `docx-tables.ts`**

- `importDocx()`: `mammoth.convertToHtml({ buffer })` → HTML; helper murni `parseDocxTables(html)` menghasilkan `Array<Record<string, unknown>>` atau `[]`.
- Bila helper menghasilkan `[]`, fallback ke `parseDocxQuestions(extractRawText)` lama — kompatibilitas penuh.
- Helper memetakan label (case-insensitive, spasi dibuang) memakai `normalizeDocxKey` yang diperluas:
  - `teks soal` / `soal` / `pertanyaan` → `Konten`
  - `jawaban a` … `jawaban h` → dikumpulkan menjadi `Opsi` berbentuk `A|teks;B|teks;…`
  - `bobot` → `Bobot`, `kunci` → `Kunci`, `kunci isian` → `KunciIsian`
  - `kiri`, `kanan`, `pernyataan`, `pembahasan`, `mode skor` → kunci bersesuaian
- Baris dengan label tidak dikenal diabaikan, tidak menggagalkan soal lain.
- Tabel tanpa baris `Tipe` dilewati, sehingga tabel petunjuk/legenda tidak ikut terimpor.
- Parser HTML minimal tanpa dependensi baru: ambil blok `<table>…</table>`, lalu `<tr>`, lalu `<td>/<th>`, buang tag, dekode entity dasar (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`).

## Test

- Unit: `apps/api/src/questions/docx-tables.test.ts` (`node:test` via `tsx`):
  - 1 tabel PG lengkap → record punya `Konten`, `Bobot`, `Opsi = A|…;B|…`, `Kunci`.
  - tabel tanpa `Tipe` → diabaikan.
  - tabel MATCHING dan ISIAN_SINGKAT → kunci `Kiri`/`Kanan` dan `KunciIsian` benar.
  - HTML tanpa tabel → `[]` (fallback terpakai).
  - `Bobot` dengan koma desimal (`0,5`) terbaca utuh.
- Integrasi: unduh template DOCX hasil generator, unggah kembali lewat `POST /questions/import` → 5 soal berhasil, bobot sesuai contoh.

## Verifikasi

- `node --import tsx --test apps/api/src/questions/docx-tables.test.ts`
- `npm run build -w @cbt/api`
- E2E/browser: unduh template Word dari modal Import soal, unggah kembali, cek laporan "5 berhasil".

## Yang tersisa untuk builder

- Kosakata label akhir bisa disesuaikan setelah guru mencoba template di lapangan.
