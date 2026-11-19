import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Enkripsi at-rest untuk rahasia kecil yang harus bisa dibaca kembali oleh
 * server (mis. `initialPassword` yang dicetak ke Kartu Login sebelum siswa
 * mengganti password).
 *
 * Format: `enc:v1:<iv b64>.<tag b64>.<ciphertext b64>` — AES-256-GCM.
 * Kunci diturunkan dari `INITIAL_PASSWORD_SECRET` (atau `JWT_SECRET` bila
 * tidak diisi) lewat SHA-256.
 *
 * Catatan: nilai lama yang belum terenkripsi (plaintext) tetap terbaca —
 * `decryptSecret` me-return apa adanya untuk baris legacy. Jalankan
 * `scripts/encrypt-initial-passwords.mjs --apply` untuk mengenkripsi baris lama.
 */

const PREFIX = 'enc:v1:';

const key = (): Buffer => {
  const secret = process.env.INITIAL_PASSWORD_SECRET ?? process.env.JWT_SECRET;
  if (!secret) throw new Error('INITIAL_PASSWORD_SECRET / JWT_SECRET belum diisi');
  return createHash('sha256').update(secret, 'utf8').digest();
};

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}.${tag.toString('base64')}.${data.toString('base64')}`;
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext
  const parts = stored.slice(PREFIX.length).split('.');
  if (parts.length !== 3) return stored;
  const [ivB, tagB, dataB] = parts;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    // Kunci berubah / data rusak — jangan bocorkan error kriptografi ke caller.
    return '********';
  }
}

export const isEncryptedSecret = (stored: string): boolean => stored.startsWith(PREFIX);
