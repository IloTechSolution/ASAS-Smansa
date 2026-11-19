import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeDocxKey, parseDocxTables } from './docx-tables';

function table(title: string, rows: Array<[string, string]>): string {
  const trs = [
    `<tr><td colspan="2"><p>${title}</p></td></tr>`,
    ...rows.map(([a, b]) => `<tr><td><p>${a}</p></td><td><p>${b}</p></td></tr>`),
  ];
  return `<table>${trs.join('')}</table>`;
}

test('tabel PG menghasilkan record dengan Opsi dari Jawaban A–D', () => {
  const rows = parseDocxTables(
    table('SOAL 1 · PG', [
      ['Tipe', 'PG'],
      ['Teks soal', 'Ibu kota Indonesia?'],
      ['Bobot', '1'],
      ['Jawaban A', 'Jakarta'],
      ['Jawaban B', 'Bandung'],
      ['Jawaban C', 'Surabaya'],
      ['Jawaban D', 'Medan'],
      ['Kunci', 'A'],
    ]),
  );
  assert.deepEqual(rows, [
    {
      Tipe: 'PG',
      Konten: 'Ibu kota Indonesia?',
      Bobot: '1',
      Opsi: 'A|Jakarta;B|Bandung;C|Surabaya;D|Medan',
      Kunci: 'A',
      __row: 'SOAL 1',
    },
  ]);
});

test('label dengan huruf besar/spasi berbeda tetap dikenali', () => {
  assert.equal(normalizeDocxKey('TEKS SOAL'), 'Konten');
  assert.equal(normalizeDocxKey('  jawaban a  '), 'Opsi');
  const rows = parseDocxTables(
    table('SOAL 2 · PG', [
      ['TIPE', 'PG'],
      ['TEKS SOAL', '2 + 2?'],
      ['jawaban a', '3'],
      ['jawaban b', '4'],
      ['KUNCI', 'B'],
    ]),
  );
  assert.equal(rows[0]?.Konten, '2 + 2?');
  assert.equal(rows[0]?.Opsi, 'A|3;B|4');
  assert.equal(rows[0]?.Kunci, 'B');
});

test('tabel tanpa baris Tipe diabaikan', () => {
  assert.deepEqual(
    parseDocxTables(table('Kolom yang dikenal', [['Kata kunci', 'Isian'], ['Bobot', '1']])),
    [],
  );
});

test('tabel MATCHING menghasilkan Kiri dan Kanan', () => {
  const rows = parseDocxTables(
    table('SOAL 3 · MATCHING', [
      ['Tipe', 'MATCHING'],
      ['Teks soal', 'Jodohkan'],
      ['Kiri', 'A;B'],
      ['Kanan', '1;2'],
    ]),
  );
  assert.equal(rows[0]?.Kiri, 'A;B');
  assert.equal(rows[0]?.Kanan, '1;2');
});

test('tabel ISIAN_SINGKAT menghasilkan KunciIsian', () => {
  const rows = parseDocxTables(
    table('SOAL 5 · ISIAN_SINGKAT', [
      ['Tipe', 'ISIAN_SINGKAT'],
      ['Teks soal', 'Ibu kota Indonesia'],
      ['KunciIsian', 'Jakarta,Nusantara'],
    ]),
  );
  assert.equal(rows[0]?.KunciIsian, 'Jakarta,Nusantara');
});

test('HTML tanpa tabel menghasilkan array kosong', () => {
  assert.deepEqual(parseDocxTables('<p>SOAL 1</p><p>Tipe: PG</p>'), []);
});

test('sel dengan dua paragraf digabung dengan spasi', () => {
  const html =
    '<table><tr><td colspan="2"><p>SOAL 6 · PG</p></td></tr>' +
    '<tr><td><p>Tipe</p></td><td><p>PG</p></td></tr>' +
    '<tr><td><p>Teks soal</p></td><td><p>baris satu</p><p>baris dua</p></td></tr></table>';
  const rows = parseDocxTables(html);
  assert.equal(rows[0]?.Konten, 'baris satu baris dua');
});

test('entity didekode sekali, teks literal &lt; tidak berubah jadi <', () => {
  const html =
    '<table><tr><td colspan="2"><p>SOAL 7 · PG</p></td></tr>' +
    '<tr><td><p>Tipe</p></td><td><p>PG</p></td></tr>' +
    '<tr><td><p>Teks soal</p></td><td><p>&amp;lt; adalah literal</p></td></tr></table>';
  const rows = parseDocxTables(html);
  assert.equal(rows[0]?.Konten, '&lt; adalah literal');
});

test('Bobot dengan koma desimal terbaca utuh', () => {
  const rows = parseDocxTables(
    table('SOAL 4 · PG', [
      ['Tipe', 'PG'],
      ['Teks soal', 'Berapa?'],
      ['Bobot', '0,5'],
      ['Jawaban A', '1'],
      ['Jawaban B', '2'],
      ['Kunci', 'A'],
    ]),
  );
  assert.equal(rows[0]?.Bobot, '0,5');
});
