import assert from 'node:assert/strict';
import { test } from 'node:test';
import mammoth from 'mammoth';
import { parseDocxTables } from './docx-tables';
import { buildDocxTemplate } from './question-templates';

test('template DOCX menghasilkan 5 tabel soal dengan Bobot', async () => {
  const buffer = await buildDocxTemplate();
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const rows = parseDocxTables(html);

  assert.equal(rows.length, 5);
  assert.deepEqual(
    rows.map((r) => r.Tipe),
    ['PG', 'PG_KOMPLEKS', 'MATCHING', 'BENAR_SALAH', 'ISIAN_SINGKAT'],
  );
  for (const row of rows) {
    assert.ok(row.Tipe, 'Tipe wajib ada');
    assert.ok(row.Konten, 'Teks soal wajib ada');
    assert.ok(row.Bobot, 'Bobot wajib ada');
  }
  assert.equal(String(rows[0]?.Opsi).startsWith('A|Jakarta'), true);
});
