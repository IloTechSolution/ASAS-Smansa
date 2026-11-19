import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SessionQuestionCache } from './session-question-cache';

test('loader dipanggil sekali untuk sesi yang sama dalam TTL', async () => {
  const cache = new SessionQuestionCache<string>(60_000, 8);
  let calls = 0;
  const loader = async () => {
    calls++;
    return new Map([['q1', 'Soal 1']]);
  };

  const first = await cache.get('s1', loader);
  const second = await cache.get('s1', loader);

  assert.equal(calls, 1);
  assert.equal(first.get('q1'), 'Soal 1');
  assert.equal(second, first);
});

test('loader dipanggil ulang setelah TTL lewat', async () => {
  const cache = new SessionQuestionCache<string>(5, 8);
  let calls = 0;
  const loader = async () => {
    calls++;
    return new Map([[`q${calls}`, `Soal ${calls}`]]);
  };

  await cache.get('s1', loader);
  await new Promise((resolve) => setTimeout(resolve, 15));
  const refreshed = await cache.get('s1', loader);

  assert.equal(calls, 2);
  assert.equal(refreshed.get('q2'), 'Soal 2');
});

test('sesi berbeda tidak berbagi cache', async () => {
  const cache = new SessionQuestionCache<string>(60_000, 8);
  let calls = 0;
  const loader = async () => {
    calls++;
    return new Map([[`q${calls}`, 'x']]);
  };

  await cache.get('s1', loader);
  await cache.get('s2', loader);

  assert.equal(calls, 2);
});

test('entri tereviksi saat melebihi batas maksimum', async () => {
  const cache = new SessionQuestionCache<string>(60_000, 2);
  const loader = async () => new Map<string, string>();

  await cache.get('s1', loader);
  await cache.get('s2', loader);
  assert.equal(cache.size, 2);

  await cache.get('s3', loader);

  assert.equal(cache.size, 2);
  assert.equal(cache.has('s1'), false);
  assert.equal(cache.has('s2'), true);
  assert.equal(cache.has('s3'), true);
});

test('invalidate menghapus satu entri tanpa mengusik yang lain', async () => {
  const cache = new SessionQuestionCache<string>(60_000, 8);
  const loader = async () => new Map<string, string>();

  await cache.get('s1', loader);
  await cache.get('s2', loader);
  cache.invalidate('s1');

  assert.equal(cache.has('s1'), false);
  assert.equal(cache.has('s2'), true);
});
