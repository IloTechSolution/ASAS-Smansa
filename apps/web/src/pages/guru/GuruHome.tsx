import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { apiFetch } from '../../lib/api';
import { Card } from '../../components/ui';

export function GuruHome() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ soal: '…', ujian: '…', sesi: '…' });
  const [statsError, setStatsError] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<{ total: number }>('/questions?limit=1'),
      apiFetch<{ total: number }>('/exams?limit=1'),
      apiFetch<{ total: number }>('/sessions?limit=1'),
    ])
      .then(([q, e, s]) => setStats({ soal: String(q.total), ujian: String(e.total), sesi: String(s.total) }))
      .catch(() => {
        setStats({ soal: '?', ujian: '?', sesi: '?' });
        setStatsError(true);
      });
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-gold-400/40">
        <h1 className="text-xl font-extrabold">Halo, {user?.name}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {stats.soal} soal · {stats.ujian} ujian · {stats.sesi} sesi.
          {statsError ? <span className="mt-1 block text-xs font-medium text-red-500">Gagal memuat statistik — periksa koneksi lalu muat ulang.</span> : null}
        </p>
      </Card>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link to="/app/guru/soal" className="glass p-5 transition hover:-translate-y-1 hover:shadow-glow">
          <p className="font-extrabold">Bank Soal ({stats.soal})</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">PG, PG Kompleks, Matching, Benar–Salah, Isian + gambar & bobot.</p>
        </Link>
        <Link to="/app/guru/ujian" className="glass p-5 transition hover:-translate-y-1 hover:shadow-glow">
          <p className="font-extrabold">Ujian ({stats.ujian})</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Susun soal per ujian, atur urutan & bobot.</p>
        </Link>
        <Link to="/app/guru/sesi" className="glass p-5 transition hover:-translate-y-1 hover:shadow-glow">
          <p className="font-extrabold">Sesi ({stats.sesi})</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Jadwal, kelas peserta, durasi & status pelaksanaan.</p>
        </Link>
        <Link to="/app/guru/soal/baru" className="glass p-5 transition hover:-translate-y-1 hover:shadow-glow">
          <p className="font-extrabold">+ Buat Soal</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Tulis soal baru dengan kunci & pembahasan.</p>
        </Link>
      </div>
    </div>
  );
}
