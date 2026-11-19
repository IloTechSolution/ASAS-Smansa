import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QUESTION_TYPE_LABEL, SCORING_MODE_LABEL } from '@cbt/shared';
import type { QuestionType, ScoringMode } from '@cbt/shared';
import { Badge, Button, Card, Spinner, cn } from '../../../components/ui';
import { ErrorBanner } from '../../../components/admin';
import { UploadImg } from '../../../components/UploadImg';
import { apiFetch, ApiError } from '../../../lib/api';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Eye,
  KeyRound,
  Printer,
  ScrollText,
} from 'lucide-react';

/* ---------------------------------- types --------------------------------- */

interface PreviewChoice {
  id: string;
  label: string;
  imageUrl: string | null;
  isKey: boolean;
}
interface PreviewStat {
  attempts: number;
  answered: number;
  blank: number;
  correct: number;
  /** Tingkat kesulitan 0..1: makin tinggi makin mudah. */
  difficulty: number;
  difficultyLabel: 'MUDAH' | 'SEDANG' | 'SULIT';
  /** Daya pembeda (D) ≥0,4 baik; <0,2 perlu perbaikan. null bila data kurang. */
  discrimination: number | null;
  discriminationLabel: 'BAIK' | 'CUKUP' | 'LEMAH' | 'BURUK' | 'BELUM_CUKUP_DATA';
  avgPercent: number;
}
interface PreviewQuestion {
  order: number;
  id: string;
  type: QuestionType;
  content: string;
  imageUrl: string | null;
  weight: number;
  scoringMode: ScoringMode;
  explanation: string | null;
  usageCount: number;
  mine: boolean;
  stats: PreviewStat | null;
  choices?: PreviewChoice[];
  pairs?: {
    left: { id: string; text: string }[];
    right: { id: string; text: string }[];
    mapping: Record<string, string>;
  };
  statements?: { id: string; text: string; answer: boolean }[];
  acceptedAnswers?: string[];
}
interface PreviewResponse {
  id: string;
  title: string;
  description: string | null;
  mapel: { name: string; code: string; kkm: number };
  createdBy: { name: string };
  totalWeight: number;
  sessions: number;
  attempts: number;
  questions: PreviewQuestion[];
}
type Filter = 'all' | 'attention' | 'nodata';
type Mode = 'guru' | 'siswa';

/** Kriteria "soal perlu perhatian" (ditampilkan di UI). */
function needsAttention(q: PreviewQuestion): boolean {
  const s = q.stats;
  if (!s) return false;
  const total = s.answered + s.blank;
  if (total === 0) return false;
  if (s.answered === 0) return true; // semua peserta mengosongkan
  if (s.blank / total >= 0.3) return true; // ≥30% kosong
  if (s.discrimination !== null && s.discrimination < 0.2) return true; // daya pembeda lemah
  if (s.avgPercent <= 30) return true; // akurasi sangat rendah
  return false;
}

const letter = (i: number) => String.fromCharCode(65 + i);

const DIFFICULTY_TONE: Record<string, string> = {
  MUDAH: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  SEDANG: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300',
  SULIT: 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300',
};
const DISCRIMINATION_TONE: Record<string, string> = {
  BAIK: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  CUKUP: 'border-lime-500/40 bg-lime-500/10 text-lime-600 dark:text-lime-300',
  LEMAH: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300',
  BURUK: 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300',
  BELUM_CUKUP_DATA: 'border-slate-400/40 bg-slate-500/10 text-slate-500 dark:text-slate-300',
};

/* ------------------------------- statistik -------------------------------- */

function StatCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {label}
      </p>
      <p className={cn('mt-0.5 truncate text-sm font-bold', tone ?? 'text-slate-800 dark:text-slate-100')}>
        {value}
      </p>
    </div>
  );
}

function StatStrip({ s }: { s: PreviewStat }) {
  return (
    <div className="mt-4 border-t border-slate-100 pt-3 dark:border-white/10">
      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <StatCell label="Terjawab" value={`${s.answered}/${s.attempts}`} />
        <StatCell label="Benar" value={`${s.correct}`} />
        <StatCell label="Kosong" value={`${s.blank}`} />
        <StatCell label="Rata-rata" value={`${s.avgPercent}%`} />
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400"
          style={{ width: `${Math.min(100, Math.max(0, s.avgPercent))}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold', DIFFICULTY_TONE[s.difficultyLabel])}>
          {s.difficultyLabel} · kesulitan {Math.round(s.difficulty * 100)}%
        </span>
        <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold', DISCRIMINATION_TONE[s.discriminationLabel])}>
          Daya pembeda {s.discriminationLabel === 'BELUM_CUKUP_DATA' ? '— data kurang' : (s.discrimination ?? 0).toFixed(2)}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------ kartu soal -------------------------------- */

function QuestionCard({ q, showKeys }: { q: PreviewQuestion; showKeys: boolean }) {
  const attention = needsAttention(q);
  const rightById = new Map((q.pairs?.right ?? []).map((r) => [r.id, r.text]));
  return (
    <Card
      className={cn(
        'print:break-inside-avoid print:shadow-none',
        showKeys && attention && 'ring-1 ring-amber-400/70',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-sm font-extrabold text-brand-700 dark:text-brand-300"
        >
          {q.order}
        </span>
        <Badge>{QUESTION_TYPE_LABEL[q.type]}</Badge>
        <Badge>Bobot {q.weight}</Badge>
        {q.scoringMode !== 'ALL_OR_NOTHING' ? <Badge>{SCORING_MODE_LABEL[q.scoringMode]}</Badge> : null}
        {showKeys && attention ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-300">
            <AlertTriangle size={12} /> Perlu perhatian
          </span>
        ) : null}
        <span className="ml-auto text-xs font-medium text-slate-400 dark:text-slate-500">
          Dipakai {q.usageCount} ujian{q.mine ? '' : ' · soal guru lain'}
        </span>
      </div>

      <p className="mt-3 whitespace-pre-wrap font-medium leading-relaxed">{q.content}</p>
      {q.imageUrl ? (
        <UploadImg src={q.imageUrl} alt="Gambar soal" className="mt-3 max-h-72 rounded-xl border border-slate-200 dark:border-white/10" />
      ) : null}

      {q.choices ? (
        <ol className="mt-3 flex flex-col gap-1.5">
          {q.choices.map((c, i) => {
            const keyed = showKeys && c.isKey;
            return (
              <li
                key={c.id}
                className={cn(
                  'rounded-xl border px-3 py-2 text-sm transition-colors',
                  keyed
                    ? 'border-emerald-500/50 bg-emerald-500/10'
                    : 'border-slate-200 dark:border-white/10',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-500 dark:text-slate-400">{letter(i)}.</span>
                  <span>{c.label}</span>
                  {keyed ? (
                    <span className="ml-auto inline-flex items-center gap-1 font-bold text-emerald-600 dark:text-emerald-300">
                      <CheckCircle2 size={14} /> Kunci
                    </span>
                  ) : null}
                </div>
                {c.imageUrl ? (
                  <div className="mt-1.5">
                    <UploadImg
                      src={c.imageUrl}
                      alt={`Gambar opsi ${letter(i)}`}
                      className="max-h-40 rounded-lg border border-slate-200 dark:border-white/10"
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {q.pairs ? (
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Kolom kiri</p>
            <ol className="flex flex-col gap-1.5">
              {q.pairs.left.map((l) => (
                <li key={l.id} className="rounded-xl border border-slate-200 px-3 py-2 dark:border-white/10">
                  {l.text}
                </li>
              ))}
            </ol>
          </div>
          <div>
            <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Kolom kanan</p>
            <ol className="flex flex-col gap-1.5">
              {q.pairs.right.map((r) => (
                <li key={r.id} className="rounded-xl border border-slate-200 px-3 py-2 dark:border-white/10">
                  {r.text}
                </li>
              ))}
            </ol>
          </div>
          {showKeys ? (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs sm:col-span-2">
              <p className="mb-1 font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Pasangan kunci</p>
              <ul className="flex flex-col gap-0.5 font-medium text-emerald-800 dark:text-emerald-200">
                {q.pairs.left.map((l) => (
                  <li key={l.id}>
                    {l.text} <span aria-hidden>→</span> {rightById.get(q.pairs!.mapping[l.id] ?? '') ?? '?'}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {q.statements ? (
        <ol className="mt-3 flex flex-col gap-1.5 text-sm">
          {q.statements.map((st, i) => (
            <li
              key={st.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 dark:border-white/10"
            >
              <span className="font-bold text-slate-500 dark:text-slate-400">{i + 1}.</span>
              <span>{st.text}</span>
              {showKeys ? (
                <span
                  className={cn(
                    'ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold',
                    st.answer
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300',
                  )}
                >
                  {st.answer ? 'Benar' : 'Salah'}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {showKeys && q.acceptedAnswers && q.acceptedAnswers.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Kunci:</span>
          {q.acceptedAnswers.map((a) => (
            <span
              key={a}
              className="inline-flex items-center rounded-full border border-emerald-500/50 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300"
            >
              {a}
            </span>
          ))}
        </div>
      ) : null}

      {showKeys && q.explanation ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Pembahasan</p>
          <p className="mt-1 whitespace-pre-wrap text-slate-600 dark:text-slate-300">{q.explanation}</p>
        </div>
      ) : null}

      {q.stats ? (
        <StatStrip s={q.stats} />
      ) : (
        <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400 dark:border-white/10 dark:text-slate-500">
          Belum ada data statistik — jalankan satu sesi percobaan untuk melihat kesulitan & daya pembeda soal ini.
        </p>
      )}
    </Card>
  );
}

/* --------------------------------- halaman --------------------------------- */

export function ExamPreview() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>('guru');
  const [filter, setFilter] = useState<Filter>('all');
  const showKeys = mode === 'guru';

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const r = await apiFetch<PreviewResponse>(`/exams/${id}/preview`);
        if (!cancelled) setData(r);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Gagal memuat pratinjau ujian');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const attentionCount = useMemo(() => data?.questions.filter(needsAttention).length ?? 0, [data]);
  const noDataCount = useMemo(() => data?.questions.filter((q) => !q.stats).length ?? 0, [data]);
  const visible = useMemo(
    () =>
      (data?.questions ?? []).filter((q) =>
        filter === 'all' ? true : filter === 'attention' ? needsAttention(q) : !q.stats,
      ),
    [data, filter],
  );

  if (loading) return <Spinner />;
  if (error || !data) {
    return (
      <div className="flex flex-col gap-4">
        <Link to={`/app/guru/ujian/${id}`} className="print:hidden">
          <Button type="button" variant="ghost">
            <ChevronLeft size={16} /> Susunan Soal
          </Button>
        </Link>
        <ErrorBanner message={error || 'Pratinjau tidak tersedia'} />
      </div>
    );
  }

  return (
    <div id="exam-preview" className="flex flex-col gap-4">
      {/* Breadcrumb & aksi */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link to={`/app/guru/ujian/${id}`}>
          <Button type="button" variant="ghost">
            <ChevronLeft size={16} /> Susunan Soal
          </Button>
        </Link>
        <span aria-hidden className="text-slate-300 dark:text-slate-600">/</span>
        <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">Pratinjau Ujian</span>
        <span className="ml-auto" />
        <Button type="button" variant="ghost" onClick={() => window.print()}>
          <Printer size={16} /> Cetak
        </Button>
      </div>

      {/* Kepala dokumen pratinjau */}
      <Card>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-gold-600 dark:text-gold-300">
              Pratinjau Ujian
            </p>
            <h1 className="mt-1 text-2xl font-extrabold leading-tight text-slate-900 dark:text-white">
              {data.title}
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {data.mapel.name} ({data.mapel.code}) · KKM {data.mapel.kkm} · dibuat oleh {data.createdBy.name}
            </p>
            {data.description ? (
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
                {data.description}
              </p>
            ) : null}
          </div>
          <ScrollText aria-hidden size={40} className="shrink-0 text-brand-500/40" />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 text-xs font-semibold text-slate-600 dark:border-white/10 dark:text-slate-300">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/10 px-3 py-1 text-brand-700 dark:text-brand-300">
            {data.questions.length} soal
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-400/15 px-3 py-1 text-gold-700 dark:text-gold-300">
            Total bobot {data.totalWeight}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-500/10 px-3 py-1">
            {data.sessions} sesi
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-500/10 px-3 py-1">
            {data.attempts} peserta selesai
          </span>
        </div>

        {showKeys && attentionCount > 0 ? (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200 print:hidden">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <p>
              <span className="font-bold">{attentionCount} soal perlu perhatian.</span>
              <span className="mt-0.5 block text-xs text-amber-700 dark:text-amber-300">
                Kriteria: ≥30% peserta mengosongkan · daya pembeda &lt; 0,2 · atau akurasi rata-rata ≤ 30%.
                Tinjau butir yang ditandai, lalu perbaiki di bank soal atau susun ulang di susunan soal.
              </span>
            </p>
          </div>
        ) : null}
      </Card>

      {/* Toolbar: mode & filter */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <div
          role="group"
          aria-label="Mode tampilan"
          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white/60 p-1 backdrop-blur dark:border-white/10 dark:bg-white/5"
        >
          <button
            type="button"
            aria-pressed={showKeys}
            onClick={() => setMode('guru')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition',
              showKeys
                ? 'bg-brand-500/15 text-brand-700 dark:text-brand-200'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400',
            )}
          >
            <KeyRound size={14} /> Tampilan Guru (kunci)
          </button>
          <button
            type="button"
            aria-pressed={!showKeys}
            onClick={() => setMode('siswa')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition',
              !showKeys
                ? 'bg-brand-500/15 text-brand-700 dark:text-brand-200'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400',
            )}
          >
            <Eye size={14} /> Tampilan Siswa
          </button>
        </div>

        <div role="group" aria-label="Filter soal" className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white/60 p-1 backdrop-blur dark:border-white/10 dark:bg-white/5">
          {(
            [
              { key: 'all', label: `Semua (${data.questions.length})` },
              { key: 'attention', label: `Perlu perhatian (${attentionCount})` },
              { key: 'nodata', label: `Belum ada data (${noDataCount})` },
            ] as { key: Filter; label: string }[]
          ).map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-bold transition',
                filter === f.key
                  ? 'bg-brand-500/15 text-brand-700 dark:text-brand-200'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Daftar soal */}
      {visible.length === 0 ? (
        <Card className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          Tidak ada soal pada filter ini.
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {visible.map((q) => (
            <QuestionCard key={q.id} q={q} showKeys={showKeys} />
          ))}
        </div>
      )}

      <p className="text-center text-xs text-slate-400 dark:text-slate-500 print:hidden">
        Statistik dihitung dari seluruh attempt selesai di semua sesi ujian ini · daya pembeda memakai
        kelompok 27% teratas/terbawah · data diperbarui setiap dibuka.
      </p>
    </div>
  );
}
