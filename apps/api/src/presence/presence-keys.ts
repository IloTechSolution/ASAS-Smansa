/** Kunci ZSET Redis: member = userId siswa, score = ms terakhir aktif. */
export const PRESENCE_KEY = 'presence:siswa';

/** Online: ping/heartbeat < 2 menit. "Baru keluar": ≤ 15 menit. */
export const ONLINE_MS = 120_000;
export const RECENT_MS = 15 * 60_000;
/** ZSET dibersihkan dari entri lebih tua dari 6 jam saat ada yang menulis. */
export const PRESENCE_MAX_AGE_MS = 6 * 3600_000;
