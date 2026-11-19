import { createHash, timingSafeEqual } from 'crypto';
import type { Request } from 'express';

/**
 * Bukti SEB yang dikirim klien:
 * - `url`: URL absolut yang diminta (harus sama persis dengan yang di-hash SEB)
 * - `hash`: nilai header `X-SafeExamBrowser-RequestHash`
 */
export interface SebProof {
  url: string;
  hash?: unknown;
}

/** Browser Exam Key bisa lebih dari satu (Windows/macOS/versi berbeda). */
export function parseSebKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

/** Header SEB berupa 64 hex, kadang berakhiran `;` seperti contoh spesifikasi. */
export function normalizeSebHash(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().replace(/^"|"$/g, '').replace(/;+$/, '').toLowerCase();
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}

/**
 * URL absolut yang di-hash SEB (termasuk query), memakai host publik proxy.
 * Proto diambil dari X-Forwarded-Proto (bukan `req.protocol`) karena `trust
 * proxy` tidak mencakup seluruh range IP Docker — di belakang Caddy (HTTPS),
 * `req.protocol` akan terbaca `http` dan hash selalu mismatch.
 */
export function reconstructedUrl(req: Request): string {
  const forwarded = req.headers['x-forwarded-host'];
  const rawHost = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const host = (rawHost?.split(',')[0] ?? req.get('host') ?? 'localhost').trim();
  const fwdProto = req.headers['x-forwarded-proto'];
  const rawProto = Array.isArray(fwdProto) ? fwdProto[0] : fwdProto;
  const proto = rawProto?.split(',')[0]?.trim().toLowerCase() || req.protocol;
  return `${proto}://${host}${req.originalUrl}`;
}

/** Fingerprint 8 hex key (untuk dicocokkan operator dengan yang tersimpan di APK). */
export function keyFingerprint(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 8);
}

/**
 * SEB menghitung SHA256(URL absolut tanpa fragment + Browser Exam Key).
 * Referensi: SEB Browser Exam Key specification.
 */
export function verifySebRequest(proof: SebProof | undefined, keys: string[]): boolean {
  const received = normalizeSebHash(proof?.hash);
  if (!proof || !received || keys.length === 0) return false;
  const got = Buffer.from(received, 'hex');
  return keys.some((key) => {
    const expected = createHash('sha256').update(`${proof.url}${key}`, 'utf8').digest();
    return expected.length === got.length && timingSafeEqual(expected, got);
  });
}
