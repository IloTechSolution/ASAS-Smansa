import { useEffect, useState } from 'react';
import { Loader2, Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card } from '../../components/ui';
import { ApiError, apiFetch } from '../../lib/api';

type DayName = 'SENIN' | 'SELASA' | 'RABU' | 'KAMIS' | 'JUMAT';

interface SessionRow {
  id: string;
  title: string | null;
  status: 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'CLOSED';
  hariPelaksanaan: DayName | null;
  visibleToSiswa: boolean;
  durationMin: number;
  exam: { id: string; title: string };
  kelasLinks: Array<{ kelas: { id: string; name: string } }>;
  _count: { attempts: number };
}

const DAY_LABEL: Record<DayName, string> = {
  SENIN: 'Hari 1 · Senin',
  SELASA: 'Hari 2 · Selasa',
  RABU: 'Hari 3 · Rabu',
  KAMIS: 'Hari 4 · Kamis',
  JUMAT: 'Hari 5 · Jumat',
};

export default function ProktorSesi() {
  const [data, setData] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<{ data: SessionRow[] }>('/sessions?limit=50')
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Gagal memuat sesi'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-10">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-brand-500/30">
        <h1 className="text-xl font-extrabold">Sesi Ujian</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Pilih sesi untuk menampilkan/menyembunyikan ujian ke siswa, merilis token, absensi, dan kartu peserta.
        </p>
      </Card>
      {error ? <Card className="border-red-500/30 text-sm text-red-500">{error}</Card> : null}
      {data.length === 0 && !error ? (
        <Card className="text-sm text-slate-500 dark:text-slate-400">Belum ada sesi ujian.</Card>
      ) : null}
      {data.map((s) => (
        <Card key={s.id} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-extrabold">{s.title ?? s.exam.title}</h2>
            {s.visibleToSiswa ? (
              <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">Tampil</Badge>
            ) : (
              <Badge>Tersembunyi</Badge>
            )}
            {s.hariPelaksanaan ? <Badge>{DAY_LABEL[s.hariPelaksanaan]}</Badge> : null}
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {s._count.attempts} peserta mulai
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {s.exam.title} · {s.durationMin} menit · kelas:{' '}
            {s.kelasLinks.map((k) => k.kelas.name).join(', ') || '-'}
          </p>
          <div className="mt-1">
            <Link to={`/app/proktor/sesi/${s.id}/pengaturan`}>
              <Button variant="ghost">
                <Settings2 size={16} /> Buka panel
              </Button>
            </Link>
          </div>
        </Card>
      ))}
    </div>
  );
}
