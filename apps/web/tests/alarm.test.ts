import assert from 'node:assert/strict';
import { test } from 'node:test';

interface FakeCalls {
  resume: number;
  bufferSource: number;
  ramps: number[];
}

function stubWindow(rejectResume = false): FakeCalls {
  const calls: FakeCalls = { resume: 0, bufferSource: 0, ramps: [] };
  class FakeAudioContext {
    state = 'suspended';
    currentTime = 0;
    sampleRate = 48000;
    destination = {} as AudioDestinationNode;
    resume() {
      calls.resume += 1;
      this.state = 'running';
      return rejectResume ? Promise.reject(new Error('resume gagal')) : Promise.resolve();
    }
    createBuffer() {
      return { getChannelData: () => new Float32Array(1) };
    }
    createBufferSource() {
      calls.bufferSource += 1;
      return { buffer: null, connect: () => undefined, start: () => undefined };
    }
    createOscillator() {
      return {
        type: 'square',
        frequency: { value: 0 },
        connect: () => undefined,
        start: () => undefined,
        stop: () => undefined,
      };
    }
    createGain() {
      return {
        gain: {
          setValueAtTime: () => undefined,
          exponentialRampToValueAtTime: (v: number) => calls.ramps.push(v),
        },
        connect: () => undefined,
      };
    }
  }
  (globalThis as unknown as { window: unknown }).window = { AudioContext: FakeAudioContext };
  return calls;
}

test('unlockAudio membuat dan melanjutkan AudioContext dalam gesture', async () => {
  const calls = stubWindow();
  const mod = await import('../src/lib/alarm.ts?unlock=1');
  mod.unlockAudio();
  assert.equal(calls.resume, 1);
  assert.ok(calls.bufferSource >= 1);
});

test('playAlarm menaikkan gain ke ALARM_GAIN 0.9 tanpa melebihi', async () => {
  const calls = stubWindow();
  const mod = await import('../src/lib/alarm.ts?gain=2');
  assert.equal(mod.ALARM_GAIN, 0.9);
  mod.playAlarm();
  assert.ok(calls.ramps.includes(0.9));
  assert.ok(calls.ramps.every((v) => v <= 0.9));
});

test('unlockAudio menelan kegagalan resume tanpa unhandled rejection', async () => {
  stubWindow(true);
  const rejections: unknown[] = [];
  const onReject = (reason: unknown) => rejections.push(reason);
  process.on('unhandledRejection', onReject);
  const mod = await import('../src/lib/alarm.ts?reject=3');
  mod.unlockAudio();
  await new Promise((resolve) => setTimeout(resolve, 25));
  process.off('unhandledRejection', onReject);
  assert.equal(rejections.length, 0);
});
