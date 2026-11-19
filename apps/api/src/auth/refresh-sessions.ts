import { randomUUID } from 'crypto';
import type Redis from 'ioredis';

/**
 * Penyimpan sesi refresh-token (P1 hardening).
 * Setiap refresh token punya `jti` yang dicatat di Redis:
 * - `refresh:{jti}` → userId (TTL = masa berlaku refresh)
 * - `refresh:user:{userId}` → SET berisi semua jti aktif milik user
 * Rotasi: sekali dipakai, jti lama dihapus — refresh curian/palsu langsung mati.
 */
const key = (jti: string) => `refresh:${jti}`;
const userKey = (userId: string) => `refresh:user:${userId}`;

/** "7d"/"15m"/"3600s" → detik (untuk TTL Redis). */
export function parseDurationSec(raw: string | undefined, fallbackSec: number): number {
  if (!raw) return fallbackSec;
  const m = /^(\d+)\s*(ms|s|m|h|d)?$/i.exec(raw.trim());
  if (!m) return fallbackSec;
  const n = Number(m[1]);
  switch ((m[2] ?? 's').toLowerCase()) {
    case 'ms':
      return Math.max(1, Math.floor(n / 1000));
    case 'm':
      return n * 60;
    case 'h':
      return n * 3600;
    case 'd':
      return n * 86400;
    default:
      return n;
  }
}

export const newJti = () => randomUUID();

export async function storeRefresh(redis: Redis, jti: string, userId: string, ttlSec: number) {
  await redis.set(key(jti), userId, 'EX', ttlSec);
  await redis.sadd(userKey(userId), jti);
  // SET mengikuti TTL terpanjang + buffer; jti kedaluwarsa dibersihkan pasif.
  await redis.expire(userKey(userId), ttlSec + 3600);
}

/**
 * Ambil + hanguskan jti (rotasi) — atomik via GETDEL (Redis ≥6.2, tersedia di
 * redis:7) supaya token curian yang dipakai bersamaan pemilik asli hanya bisa
 * menangkap satu dari dua permintaan, bukan keduanya.
 * Mengembalikan userId bila jti masih berlaku, `null` bila sudah dipakai/dicabut/kedaluwarsa.
 */
export async function consumeRefresh(redis: Redis, jti: string): Promise<string | null> {
  const userId = await redis.getdel(key(jti));
  if (!userId) return null;
  await redis.srem(userKey(userId), jti);
  return userId;
}

/** Cabut satu refresh token (logout). */
export async function revokeRefresh(redis: Redis, jti: string) {
  const userId = await redis.get(key(jti));
  if (userId) await redis.srem(userKey(userId), jti);
  await redis.del(key(jti));
}

/** Cabut SEMUA sesi refresh milik user (ganti/reset password). */
export async function revokeUserRefreshes(redis: Redis, userId: string) {
  const jtis = await redis.smembers(userKey(userId));
  if (jtis.length > 0) await redis.del(...jtis.map((j) => key(j)));
  await redis.del(userKey(userId));
}
