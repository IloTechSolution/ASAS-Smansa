import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AttemptSessionLookup, attemptSessionKey } from './attempt-session-lookup';

function stubRedis(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  const calls = { get: [] as string[], set: [] as string[] };
  return {
    store,
    calls,
    redis: {
      async get(key: string) {
        calls.get.push(key);
        return store.get(key) ?? null;
      },
      async set(key: string, value: string, mode: 'EX', ttl: number) {
        assert.equal(mode, 'EX');
        assert.equal(ttl, 86_400);
        calls.set.push(key);
        store.set(key, value);
        return 'OK';
      },
    },
  };
}

test('kunci cache memisahkan attempt dan siswa', () => {
  assert.equal(attemptSessionKey('a1', 'u1'), 'attempt:a1:session:u1');
  assert.notEqual(attemptSessionKey('a1', 'u1'), attemptSessionKey('a1', 'u2'));
});

test('cache hit tidak memanggil loader', async () => {
  const { redis, calls, store } = stubRedis({ 'attempt:a1:session:u1': 's1' });
  const lookup = new AttemptSessionLookup(redis, 86_400);
  let loads = 0;

  const sessionId = await lookup.get('a1', 'u1', async () => {
    loads++;
    return 's-lain';
  });

  assert.equal(sessionId, 's1');
  assert.equal(loads, 0);
  assert.deepEqual(calls.set, []);
  assert.equal(store.get('attempt:a1:session:u1'), 's1');
});

test('cache miss memanggil loader lalu menyimpan hasilnya', async () => {
  const { redis, calls, store } = stubRedis();
  const lookup = new AttemptSessionLookup(redis, 86_400);
  let loads = 0;

  const sessionId = await lookup.get('a1', 'u1', async () => {
    loads++;
    return 's1';
  });

  assert.equal(sessionId, 's1');
  assert.equal(loads, 1);
  assert.deepEqual(calls.set, ['attempt:a1:session:u1']);
  assert.equal(store.get('attempt:a1:session:u1'), 's1');
});

test('loader return null tidak ditulis ke cache', async () => {
  const { redis, calls } = stubRedis();
  const lookup = new AttemptSessionLookup(redis, 86_400);

  const sessionId = await lookup.get('a1', 'u1', async () => null);

  assert.equal(sessionId, null);
  assert.deepEqual(calls.set, []);
});

test('remember menyimpan sessionId hasil otorisasi join', async () => {
  const { redis, store } = stubRedis();
  const lookup = new AttemptSessionLookup(redis, 86_400);

  await lookup.remember('a1', 'u1', 's1');

  assert.equal(store.get('attempt:a1:session:u1'), 's1');
});
