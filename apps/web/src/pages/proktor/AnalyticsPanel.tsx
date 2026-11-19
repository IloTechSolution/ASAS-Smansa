import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Spinner } from '../../components/ui';
import { ErrorBanner } from '../../components/admin';
import { ApiError, apiFetch } from '../../lib/api';

interface Stats {
  examId: string;
  totalAttempt: number;
  finished: number;
  submitted: number;
  avgScore: number;
  maxScore: number;
  avgPercent: number;
  highest: number;
  lowest: number;
  totalViolations: number;
}

/** Analitik ringkas satu ujian (proktor) — memakai apiFetch agar token diperbarui otomatis. */
export default function AnalyticsPanel({ examId: examIdProp }: { examId?: string }) {
  const { examId: examIdParam } = useParams();
  const examId = examIdProp || examIdParam || '';
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!examId) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    apiFetch<Stats>(`/exams/${examId}/analytics`)
      .then((d) => alive && setStats(d))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : 'Gagal memuat analitik'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [examId]);

  if (loading) return <Spinner />;
  if (!examId) {
    return (
      <Card className="text-sm text-slate-500 dark:text-slate-400">
        Buka analitik dari halaman ujian untuk melihat statistiknya.
      </Card>
    );
  }

  const tiles: Array<[string, string]> = stats
    ? [
        ['Total percobaan', String(stats.totalAttempt)],
        ['Rata-rata nilai', `${stats.avgScore} / ${stats.maxScore} (${stats.avgPercent}%)`],
        ['Sudah selesai', `${stats.finished}/${stats.totalAttempt}`],
        ['Tertinggi / terendah', `${stats.highest} / ${stats.lowest}`],
        ['Pelanggaran', String(stats.totalViolations)],
      ]
    : [];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="text-xl font-extrabold">Analitik Ujian</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Ringkasan cepat. Analisis per butir soal (kesulitan & daya pembeda) ada di halaman penilaian guru.
        </p>
        <ErrorBanner message={error} onClose={() => setError('')} />
        {stats ? (
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            {tiles.map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-500/5 px-3 py-2 dark:bg-white/5">
                <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
                <p className="text-lg font-extrabold">{value}</p>
              </div>
            ))}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
