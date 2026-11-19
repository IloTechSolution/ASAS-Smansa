/** Kunci Redis heartbeat per attempt (TTL 90 dtk, dipakai juga oleh gateway). */
export const heartbeatKey = (attemptId: string) => `attempt:${attemptId}:hb`;

/**
 * MGET mengembalikan nilai dalam urutan key yang diminta. Pemetaan ini mengubah
 * hasil satu MGET menjadi peta attemptId → timestamp, menggantikan satu GET per
 * attempt (400 GET per refresh papan pada sesi 400 peserta).
 */
export function heartbeatMapFromMget(attemptIds: string[], values: Array<string | null>): Map<string, number> {
  const out = new Map<string, number>();
  attemptIds.forEach((id, i) => {
    const raw = values[i];
    if (!raw) return;
    const n = Number(raw);
    if (Number.isFinite(n)) out.set(id, n);
  });
  return out;
}
