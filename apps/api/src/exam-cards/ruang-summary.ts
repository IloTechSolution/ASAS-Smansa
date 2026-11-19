/** Ringkasan ruang ujian siswa per kelas (untuk panel pratinjau kartu). */
export interface RuangGroup {
  kelasId: string | null;
  ruang: string | null;
}

export function ruangByKelas(groups: RuangGroup[]): Map<string, string | null> {
  const byKelas = new Map<string, Set<string>>();
  for (const g of groups) {
    if (!g.kelasId || !g.ruang) continue;
    if (!byKelas.has(g.kelasId)) byKelas.set(g.kelasId, new Set());
    byKelas.get(g.kelasId)!.add(g.ruang);
  }
  const out = new Map<string, string | null>();
  for (const [kelasId, rooms] of byKelas) out.set(kelasId, [...rooms].sort().join(', '));
  return out;
}
