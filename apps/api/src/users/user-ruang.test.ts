import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeRuang } from './user-ruang';

test('ruang siswa dibersihkan dari spasi', () => {
  assert.equal(normalizeRuang('  Lab 1 ', 'SISWA'), 'Lab 1');
});

test('ruang hanya boleh angka/huruf bebas sampai 30 karakter', () => {
  assert.equal(normalizeRuang('A'.repeat(40), 'SISWA'), 'A'.repeat(30));
  assert.equal(normalizeRuang('20', 'SISWA'), '20');
});

test('ruang kosong atau bukan teks menjadi null', () => {
  assert.equal(normalizeRuang('   ', 'SISWA'), null);
  assert.equal(normalizeRuang('', 'SISWA'), null);
  assert.equal(normalizeRuang(null, 'SISWA'), null);
  assert.equal(normalizeRuang(42, 'SISWA'), null);
});

test('ruang tidak disimpan untuk selain siswa', () => {
  assert.equal(normalizeRuang('Lab 1', 'GURU'), null);
  assert.equal(normalizeRuang('Lab 1', 'ADMIN'), null);
  assert.equal(normalizeRuang('Lab 1', 'PROKTOR'), null);
});
