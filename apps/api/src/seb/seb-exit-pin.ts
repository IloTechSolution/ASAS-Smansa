import { createHash, createHmac, timingSafeEqual } from 'crypto';

/** Format penyimpanan GlobalConfig SEB_EXIT_PIN — tidak pernah dikembalikan ke klien. */
const HMAC_PREFIX = 'hmac:v1:';

const pinSecret = (): string => {
  const s = process.env.PIN_HASH_SECRET ?? process.env.JWT_SECRET;
  if (!s) throw new Error('PIN_HASH_SECRET / JWT_SECRET belum diisi');
  return s;
};

const hmacHex = (pin: string): string =>
  createHmac('sha256', pinSecret()).update(pin, 'utf8').digest('hex');

const legacySha256Hex = (pin: string): string =>
  createHash('sha256').update(pin, 'utf8').digest('hex');

/** Hash untuk disimpan (HMAC-SHA256 berbatas nilai server — PIN 4–8 digit tidak bisa dirapikan offline walau DB bocor). */
export function hashPin(pin: string): string {
  return `${HMAC_PREFIX}${hmacHex(pin)}`;
}

/** Bandingkan PIN input dengan hash tersimpan (constant-time).
 * Mendukung format legacy (SHA-256 polos tanpa salt) agar PIN yang sudah
 * diatur tetap berfungsi — pemanggil sebaiknya menyimpan ulang dengan
 * `hashPin()` setelah verifikasi legacy berhasil (lihat pinNeedsUpgrade). */
export function verifyPinAgainstHash(pin: string, storedHash: string): boolean {
  if (storedHash.startsWith(HMAC_PREFIX)) {
    const expected = storedHash.slice(HMAC_PREFIX.length);
    if (!/^[a-f0-9]{64}$/i.test(expected)) return false;
    const a = Buffer.from(hmacHex(pin), 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }
  if (!/^[a-f0-9]{64}$/i.test(storedHash)) return false;
  const a = Buffer.from(legacySha256Hex(pin), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** True bila hash tersimpan masih format legacy dan perlu disimpan ulang sebagai HMAC. */
export function pinNeedsUpgrade(storedHash: string): boolean {
  return !storedHash.startsWith(HMAC_PREFIX);
}

export const SEB_EXIT_PIN_KEY = 'SEB_EXIT_PIN';
export const SEB_EXIT_FAIL_WINDOW_SEC = 300;
export const SEB_EXIT_FAIL_MAX = 10;
