import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heartbeatKey, heartbeatMapFromMget } from './heartbeat-batch';

test('kunci heartbeat mengikuti format yang dipakai gateway', () => {
  assert.equal(heartbeatKey('a1'), 'attempt:a1:hb');
});

test('hasil MGET dipetakan ke attemptId sesuai urutan', () => {
  const map = heartbeatMapFromMget(['a1', 'a2', 'a3'], ['1000', null, '3000']);

  assert.equal(map.size, 2);
  assert.equal(map.get('a1'), 1000);
  assert.equal(map.has('a2'), false);
  assert.equal(map.get('a3'), 3000);
});

test('nilai MGET bukan angka diabaikan', () => {
  const map = heartbeatMapFromMget(['a1', 'a2'], ['bukan-angka', '2000']);

  assert.equal(map.has('a1'), false);
  assert.equal(map.get('a2'), 2000);
});

test('daftar kosong menghasilkan peta kosong', () => {
  assert.equal(heartbeatMapFromMget([], []).size, 0);
});
