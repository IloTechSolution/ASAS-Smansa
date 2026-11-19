export const ALARM_GAIN = 0.9;

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    return ctx;
  } catch {
    return null;
  }
}

export function unlockAudio(): void {
  const ac = audio();
  if (!ac) return;
  try {
    const buffer = ac.createBuffer(1, 1, ac.sampleRate);
    const source = ac.createBufferSource();
    source.buffer = buffer;
    source.connect(ac.destination);
    source.start();
  } catch {
    return;
  }
}

/**
 * Klakson pelanggaran untuk browser (di APK dipakai SebBridge.alarm → alarm
 * natif stream ALARM). Dua nada tinggi-rendah, 3 repetisi ±1,7 dtk.
 */
export function playAlarm(long = false) {
  const ac = audio();
  if (!ac) return;
  const beep = (freq: number, at: number, dur: number) => {
    const t0 = ac.currentTime + at;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(ALARM_GAIN, t0 + 0.02);
    gain.gain.setValueAtTime(ALARM_GAIN, t0 + dur - 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.01);
  };
  const reps = long ? 4 : 2;
  for (let i = 0; i < reps; i++) {
    beep(932, i * 0.42, 0.17);
    beep(699, i * 0.42 + 0.2, 0.17);
  }
}
