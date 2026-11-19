import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Loader2 } from 'lucide-react';
import { Badge, Button, Card } from '../../../components/ui';
import { ErrorBanner } from '../../../components/admin';
import { ApiError, apiFetch } from '../../../lib/api';

type DayName = 'SENIN' | 'SELASA' | 'RABU' | 'KAMIS' | 'JUMAT';

interface NilaiRow {
  id: string;
  title: string | null;
  hariPelaksanaan: DayName | null;
  visibleToSiswa: boolean;
  resultsPublished: boolean;
  durationMin: number;
  exam: { id: string; title: string; mapel?: { name: string } | null };
  _count: { attempts: number };
}

const DAY_LABEL: Record<DayName, string> = {
  SENIN: 'Hari 1 · Senin',
  SELASA: 'Hari 2 · Selasa',
  RABU: 'Hari 3 · Rabu',
  KAMIS: 'Hari 4 · Kamis',
  JUMAT: 'Hari 5 · Jumat',
};

/** Indeks penilaian — daftar sesi + masuk ke halaman nilai per sesi. */
export default function NilaiList() {
  const [rows, setRows] = useState<NilaiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<{ data: NilaiRow[] }>('/sessions?limit=100');
      // Urutan: yang sudah terbit hasilnya di bawah, yang berjalan di atas.
      setRows([...res.data].sort((a, b) => Number(a.resultsPublished) - Number(b.resultsPublished) || a.id.localeCompare(b.id)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal memuat daftar nilai');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-brand-500/30">
        <h1 className="text-xl font-extrabold">Nilai</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Daftar sesi ujian — klik "Kelola Nilai" untuk statistik, rincian per butir, review manual, dan terbitkan hasil.
        </p>
      </Card>

      <ErrorBanner message={error} onClose={() => setError('')} />

      {loading ? (
        <Card className="flex items-center justify-center p-10"><Loader2 className="animate-spin text-slate-400" /></Card>
      ) : rows.length === 0 ? (
        <Card className="text-sm text-slate-500 dark:text-slate-400">Belum ada sesi. Buat sesi terlebih dahulu di menu Sesi.</Card>
      ) : null}

      {rows.map((r) => (
        <Card key={r.id} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-extrabold">{r.title ?? r.exam.title}</h2>
            {r.hariPelaksanaan ? <Badge>{DAY_LABEL[r.hariPelaksanaan]}</Badge> : null}
            {r.resultsPublished ? (
              <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">Hasil terbit</Badge>
            ) : (
              <Badge>Belum terbit</Badge>
            )}
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {r.exam.title}{r.exam.mapel ? ` · ${r.exam.mapel.name}` : ''} · {r.durationMin} menit · {r._count.attempts} attempt
          </p>
          <div>
            <Link to={`/app/guru/sesi/${r.id}/penilaian`}>
              <Button type="button">Kelola Nilai <ChevronRight size={16} /></Button>
            </Link>
          </div>
        </Card>
      ))}
    </div>
  );
}
