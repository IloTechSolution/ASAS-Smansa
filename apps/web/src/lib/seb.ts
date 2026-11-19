/**
 * Jembatan Safe Exam Browser (klien Android kustom): bila halaman berjalan di
 * dalam APK SEB, APK mengekspos handler native untuk menghitung
 * SHA-256(url absolut + Browser Exam Key) — sama dengan header
 * X-SafeExamBrowser-RequestHash pada SEB desktop. Browser biasa tidak
 * memiliki bridge ini sehingga tidak ada header yang dikirim (perilaku
 * web tidak berubah).
 */
declare global {
  interface Window {
    SebBridge?: {
      requestHash?: (url: string) => Promise<string> | string;
      /** APK memancarkan bunyi/getar pelanggaran (alarm STREAM_ALARM). Browser: undefined. */
      alarm?: (reason: string) => void;
      /** APK menaikkan volume STREAM_ALARM ke maksimum. Browser: undefined. */
      maximizeVolume?: () => void;
    };
    flutter_inappwebview?: {
      callHandler: (name: string, ...args: unknown[]) => Promise<unknown>;
    };
  }
}

/** Bunyikan alarm pelanggaran di APK (keluar tab, fullscreen exit, dll.). No-op di browser. */
export const sebAlarm = (reason: string): void => {
  try {
    window.SebBridge?.alarm?.(String(reason || 'violation'));
  } catch {
    // Bukan di APK — abaikan.
  }
};

/** Minta APK menaikkan volume alarm ke maksimum. No-op di browser biasa. */
export const sebMaximizeVolume = (): void => {
  try {
    window.SebBridge?.maximizeVolume?.();
  } catch {
    // Bukan di APK — abaikan.
  }
};

export const hasSebBridge = (): boolean =>
  typeof window !== 'undefined' &&
  (typeof window.SebBridge?.requestHash === 'function' ||
    typeof window.flutter_inappwebview?.callHandler === 'function');

/** Deteksi mode SEB (desktop ASLI atau APK kustom). */
export const isSebClient = (): boolean =>
  (typeof navigator !== 'undefined' && /SEB|SafeExamBrowser/i.test(navigator.userAgent)) ||
  hasSebBridge();

/** SHA-256(url absolut + BrowserExamKey) dihitung APK di native. Browser → null. */
export async function sebRequestHash(url: string): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    let raw: unknown;
    if (typeof window.SebBridge?.requestHash === 'function') {
      raw = await window.SebBridge.requestHash(url);
    } else if (typeof window.flutter_inappwebview?.callHandler === 'function') {
      raw = await window.flutter_inappwebview.callHandler('SebRequestHash', url);
    } else {
      return null;
    }
    const clean = String(raw ?? '').trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(clean) ? clean : null;
  } catch {
    return null;
  }
}
