/**
 * Cache soal per sesi untuk jalur autosave.
 *
 * Susun soal dikunci begitu sebuah attempt ada di ujian (lihat Fase 3/audit 7 Nov),
 * sehingga daftar soal bersifat immutable selama sesi berjalan — aman di-cache.
 * Cache ini hanya dipakai untuk VALIDASI jawaban; DB tetap sumber kebenaran nilai.
 */
export class SessionQuestionCache<T> {
  private readonly entries = new Map<string, { byId: Map<string, T>; at: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  get size() {
    return this.entries.size;
  }

  has(sessionId: string) {
    return this.entries.has(sessionId);
  }

  async get(sessionId: string, loader: () => Promise<Map<string, T>>): Promise<Map<string, T>> {
    const hit = this.entries.get(sessionId);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.byId;

    const byId = await loader();
    if (!this.entries.has(sessionId) && this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(sessionId, { byId, at: Date.now() });
    return byId;
  }

  invalidate(sessionId: string) {
    this.entries.delete(sessionId);
  }
}
