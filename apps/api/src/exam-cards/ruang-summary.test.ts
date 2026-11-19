import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ruangByKelas } from './ruang-summary';

test('ruang siswa dikelompokkan per kelas', () => {
  const out = ruangByKelas([
    { kelasId: 'k1', ruang: 'Ruang 2' },
    { kelasId: 'k1', ruang: 'Ruang 1' },
    { kelasId: 'k2', ruang: 'Ruang 1' },
  ]);

  assert.equal(out.get('k1'), 'Ruang 1, Ruang 2');
  assert.equal(out.get('k2'), 'Ruang 1');
});

test('ruang kosong dan kelas null diabaikan', () => {
  const out = ruangByKelas([
    { kelasId: 'k1', ruang: null },
    { kelasId: null, ruang: 'Ruang 1' },
    { kelasId: 'k1', ruang: 'Ruang 3' },
  ]);

  assert.equal(out.size, 1);
  assert.equal(out.get('k1'), 'Ruang 3');
});

test('duplikat ruang dalam satu kelas tidak diulang', () => {
  const out = ruangByKelas([
    { kelasId: 'k1', ruang: 'Ruang 1' },
    { kelasId: 'k1', ruang: 'Ruang 1' },
  ]);

  assert.equal(out.get('k1'), 'Ruang 1');
});

test('tanpa data menghasilkan peta kosong', () => {
  assert.equal(ruangByKelas([]).size, 0);
});
