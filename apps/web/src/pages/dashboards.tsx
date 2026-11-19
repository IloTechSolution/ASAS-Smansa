import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Activity, AlertTriangle, CalendarClock, ClipboardCheck, KeyRound, Loader2, Radio, Settings2, ShieldAlert, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Card } from '../components/ui';
import { ApiError, apiFetch } from '../lib/api';

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

interface MonitorSummary {
  total: number;
  inProgress: number;
  submitted: number;
  expired: number;
  forced: number;
  online: number;
  violations: number;
}

const DAY_LABEL: Record<DayName, string> = {
  SENIN: 'Hari 1 · Senin',
  SELASA: 'Hari 2 · Selasa',
  RABU: 'Hari 3 · Rabu',
  KAMIS: 'Hari 4 · Kamis',
  JUMAT: 'Hari 5 · Jumat',
};

const ACTIVE_WATCH_LIMIT = 6;

function Stat({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
  return (
    <Card>
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
        {icon} {label}
      </p>
      <p className="mt-1 text-3xl font-extrabold">{value}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
    </Card>
  );
}

/** Dashboard proktor: pantau pelaksanaan ujian yang sedang berjalan. */
export function ProktorDashboard() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [boards, setBoards] = useState<Record<string, MonitorSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ data: SessionRow[] }>('/sessions?limit=100');
      setSessions(res.data);
      setError('');
      const active = res.data.filter((s) => s.visibleToSiswa).slice(0, ACTIVE_WATCH_LIMIT);
      const pairs = await Promise.all(
        active.map(async (s) => {
          try {
            const board = await apiFetch<{ summary: MonitorSummary }>(`/sessions/${s.id}/monitoring`);
            return [s.id, board.summary] as const;
          } catch {
            // Satu sesi gagal dibaca tidak boleh mematikan seluruh ringkasan.
            return null;
          }
        }),
      );
      setBoards(Object.fromEntries(pairs.filter((p): p is readonly [string, MonitorSummary] => p !== null)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal memuat ringkasan sesi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && sessions.length === 0) {
    return (
      <div className="flex items-center justify-center p-10">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  const visible = sessions.filter((s) => s.visibleToSiswa);
  const hidden = sessions.length - visible.length;
  const watched = visible.filter((s) => boards[s.id]);
  const totalAttempts = sessions.reduce((n, s) => n + s._count.attempts, 0);
  const online = watched.reduce((n, s) => n + boards[s.id].online, 0);
  const inProgress = watched.reduce((n, s) => n + boards[s.id].inProgress, 0);
  const violations = watched.reduce((n, s) => n + boards[s.id].violations, 0);

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-brand-500/30">
        <h1 className="text-xl font-extrabold">Halo, {user?.name}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Pantau sesi yang sedang berjalan, rilis token, catat absensi, dan cetak kartu peserta dari menu di bawah.
        </p>
      </Card>

      {error ? (
        <Card className="border-red-500/30">
          <p className="text-sm font-medium text-red-500">{error}</p>
          <div className="mt-3">
            <Button variant="ghost" onClick={() => void load()}>
              Coba lagi
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<Radio size={16} />} label="Sesi tampil" value={String(visible.length)} hint={`${hidden} tersembunyi`} />
        <Stat icon={<Users size={16} />} label="Sedang mengerjakan" value={String(inProgress)} hint={`${online} peserta online`} />
        <Stat icon={<ShieldAlert size={16} />} label="Insiden terpantau" value={String(violations)} hint="Total pelanggaran integritas" />
        <Stat icon={<Activity size={16} />} label="Total peserta mulai" value={String(totalAttempts)} hint={`${sessions.length} sesi tercatat`} />
      </div>

      <Card className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="flex items-center gap-2 text-base font-extrabold">
            <ClipboardCheck size={18} /> Jalankan sesi
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Semua sesi (termasuk yang tersembunyi) ada di daftar sesi. Tampilkan ke siswa dari panel pelaksanaan.
          </p>
        </div>
        <Link to="/app/proktor/sesi">
          <Button>
            <Settings2 size={16} /> Sesi &amp; Token
          </Button>
        </Link>
      </Card>

      {visible.length === 0 ? (
        <Card>
          <h2 className="flex items-center gap-2 text-base font-extrabold">
            <CalendarClock size={18} /> Tidak ada sesi yang tampil
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Belum ada ujian yang sedang berjalan. Buka <strong>Sesi &amp; Token</strong> → panel pelaksanaan → <strong>Tampilkan ke Siswa</strong>.
          </p>
        </Card>
      ) : (
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex items-center gap-2 text-base font-extrabold">
              <Radio size={18} /> Sesi tampil sekarang
            </h2>
            <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">{visible.length} sesi</Badge>
          </div>
          <div className="flex flex-col divide-y divide-slate-200 dark:divide-white/10">
            {visible.map((s) => {
              const b = boards[s.id];
              return (
                <div key={s.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 md:flex-row md:items-center">
                  <div className="min-w-0 md:mr-auto">
                    <p className="truncate font-bold">{s.title ?? s.exam.title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {s.exam.title} · {s.hariPelaksanaan ? DAY_LABEL[s.hariPelaksanaan] : '—'} · {s.durationMin} mnt · kelas:{' '}
                      {s.kelasLinks.map((k) => k.kelas.name).join(', ') || '-'}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      {b ? (
                        <>
                          <span>{b.inProgress} mengerjakan</span>
                          <span>· {b.online} online</span>
                          <span>· {b.submitted} selesai</span>
                          {b.violations > 0 ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-300">
                              <AlertTriangle size={12} /> {b.violations} pelanggaran
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span>{s._count.attempts} peserta mulai</span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link to={`/app/proktor/sesi/${s.id}/token`}>
                      <Button variant="ghost">
                        <KeyRound size={16} /> Token
                      </Button>
                    </Link>
                    <Link to={`/app/proktor/sesi/${s.id}/absensi`}>
                      <Button variant="ghost">
                        <ClipboardCheck size={16} /> Absensi
                      </Button>
                    </Link>
                    <Link to={`/app/proktor/sesi/${s.id}/monitoring`}>
                      <Button>
                        <Activity size={16} /> Monitoring
                      </Button>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
