import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { apiFetch } from '../../lib/api';
import { Card } from '../../components/ui';

function Stat({ label, value, hint, accent }: { label: string; value: string; hint: string; accent?: boolean }) {
  return (
    <Card className={accent ? 'border-brand-500/30' : undefined}>
      <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-3xl font-extrabold">{value}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
    </Card>
  );
}

const GROUPS: Array<{ title: string; links: Array<{ to: string; label: string; desc: string }> }> = [
  {
    title: 'Akademik',
    links: [
      { to: '/app/guru/soal', label: 'Bank Soal', desc: 'Semua soal — PG, PG Kompleks, Matching, Benar–Salah, Isian' },
      { to: '/app/guru/ujian', label: 'Ujian', desc: 'Kelola ujian & penyusunan soal' },
      { to: '/app/guru/sesi', label: 'Sesi & Nilai', desc: 'Jadwal, kelas peserta, penilaian & publish' },
    ],
  },
  {
    title: 'Pelaksanaan',
    links: [
      { to: '/app/proktor/sesi', label: 'Panel Proktor', desc: 'Token, absensi, pengaturan & kartu' },
      { to: '/app/pelanggaran', label: 'Monitoring Pelanggaran', desc: 'Log integritas lintas sesi' },
    ],
  },
  {
    title: 'Data Master',
    links: [
      { to: '/app/admin/pengguna', label: 'Pengguna', desc: 'CRUD + import Excel + reset password' },
      { to: '/app/admin/siswa', label: 'Siswa', desc: 'Import Excel + kelas otomatis + CRUD' },
      { to: '/app/admin/mapel', label: 'Mapel', desc: 'Mata pelajaran' },
    ],
  },
  {
    title: 'Sistem',
    links: [
      { to: '/app/admin/pengaturan', label: 'Konfigurasi', desc: 'Pengaturan global aplikasi' },
      { to: '/app/admin/audit', label: 'Audit Log', desc: 'Jejak aksi penting seluruh pengguna' },
    ],
  },
];

export function AdminHome() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ pengguna: '…', kelas: '…', mapel: '…', ujian: '…', sesi: '…', aktif: '…' });
  const [statsError, setStatsError] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<{ total: number }>('/users?limit=1'),
      apiFetch<unknown[]>('/kelas'),
      apiFetch<unknown[]>('/mapel'),
      apiFetch<{ total: number }>('/exams?limit=1'),
      apiFetch<{ total: number }>('/sessions?limit=1'),
      apiFetch<{ total: number }>('/sessions?visible=true&limit=1'),
    ])
      .then(([u, k, m, ex, s, aktif]) =>
        setStats({
          pengguna: String(u.total),
          kelas: String(k.length),
          mapel: String(m.length),
          ujian: String(ex.total),
          sesi: String(s.total),
          aktif: String(aktif.total),
        }),
      )
      .catch(() => {
        setStats({ pengguna: '?', kelas: '?', mapel: '?', ujian: '?', sesi: '?', aktif: '?' });
        setStatsError(true);
      });
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-brand-500/30">
        <h1 className="text-xl font-extrabold">Halo, {user?.name}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Panel operator: pantau operasional ujian atau kelola data master — semua modul tersedia untuk admin.
        </p>
        {statsError ? (
          <p className="mt-2 text-xs font-medium text-red-500">Gagal memuat statistik — periksa koneksi lalu muat ulang.</p>
        ) : null}
      </Card>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Pengguna" value={stats.pengguna} hint="Semua role" />
        <Stat label="Kelas" value={stats.kelas} hint="Semua TA" />
        <Stat label="Mapel" value={stats.mapel} hint="Mata pelajaran" />
        <Stat label="Ujian" value={stats.ujian} hint="Semua guru" />
        <Stat label="Sesi" value={stats.sesi} hint="Semua status" />
        <Stat label="Sesi Aktif" value={stats.aktif} hint="Sedang berjalan" accent />
      </div>
      {GROUPS.map((g) => (
        <div key={g.title}>
          <p className="mb-2 text-xs font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {g.title}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {g.links.map((l) => (
              <Link key={l.to} to={l.to} className="glass p-5 transition hover:-translate-y-1 hover:shadow-glow">
                <p className="font-extrabold">{l.label}</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{l.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
