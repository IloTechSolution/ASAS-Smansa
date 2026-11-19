/**
 * Ruang Ujian adalah teks/angka bebas yang melekat ke SISWA (bukan kelas),
 * hanya sebagai informasi. Tidak dipakai untuk menentukan peserta ujian.
 */
export function normalizeRuang(value: unknown, role: string): string | null {
  if (role !== 'SISWA' || typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 30) : null;
}
