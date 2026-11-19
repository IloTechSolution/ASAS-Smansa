import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardColumns } from './card-columns';

test('titik dua berada di posisi tetap, bukan mengikuti panjang label', () => {
  const c = cardColumns(20, 266);
  const labels = ['Nama Peserta', 'Kelas', 'Username Login', 'Password Login', 'Ruang Ujian'];

  for (const label of labels) {
    assert.equal(c.colonX, 20 + 12 + c.labelW, `label ${label}`);
    assert.ok(c.colonX >= 20 + 12 + Math.ceil(label.length * 3.6));
  }
});

test('nilai mengawal titik dua dengan jarak tetap', () => {
  const c = cardColumns(20, 266);
  assert.equal(c.valueX - c.colonX, 12);
  assert.equal(c.valueW, 266 - c.labelW - 24);
});
