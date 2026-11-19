import assert from 'node:assert/strict';
import { test } from 'node:test';

test('sebMaximizeVolume memanggil bridge saat tersedia', async () => {
  let called = 0;
  (globalThis as unknown as { window: unknown }).window = {
    SebBridge: {
      maximizeVolume: () => {
        called += 1;
      },
    },
  };
  const mod = await import(`../src/lib/seb.ts?vol=${Date.now()}`);
  mod.sebMaximizeVolume();
  assert.equal(called, 1);
});

test('sebMaximizeVolume tidak melempar tanpa bridge', async () => {
  (globalThis as unknown as { window: unknown }).window = {};
  const mod = await import(`../src/lib/seb.ts?novol=${Date.now()}`);
  assert.doesNotThrow(() => mod.sebMaximizeVolume());
});
