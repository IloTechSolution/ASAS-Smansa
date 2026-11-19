/** Kunci cache sessionId attempt, dibatasi oleh id siswa agar tidak bisa dipakai lintak peserta. */
export const attemptSessionKey = (attemptId: string, studentId: string) =>
  `attempt:${attemptId}:session:${studentId}`;

interface SessionStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
}

/**
 * SessionId attempt hasil otorisasi `attempt:join` disimpan di Redis.
 * Heartbeat tiap 25 detik lalu cukup GET Redis — tanpa query Prisma
 * (≈32 query DB/detik pada 800 siswa). Fallback ke loader bila cache miss.
 */
export class AttemptSessionLookup {
  constructor(
    private readonly store: SessionStore,
    private readonly ttlSec: number,
  ) {}

  async get(attemptId: string, studentId: string, load: () => Promise<string | null>): Promise<string | null> {
    const key = attemptSessionKey(attemptId, studentId);
    let cached: string | null = null;
    try {
      cached = await this.store.get(key);
    } catch {
      // Redis opsional — fallback ke DB.
    }
    if (cached) return cached;

    const sessionId = await load();
    if (sessionId) await this.remember(attemptId, studentId, sessionId);
    return sessionId;
  }

  async remember(attemptId: string, studentId: string, sessionId: string) {
    try {
      await this.store.set(attemptSessionKey(attemptId, studentId), sessionId, 'EX', this.ttlSec);
    } catch {
      // Redis opsional — heartbeat berikutnya akan fallback ke DB.
    }
  }
}
