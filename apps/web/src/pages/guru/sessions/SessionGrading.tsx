import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiDownload, apiFetch, ApiError } from '../../../lib/api';
import { Badge, Button, Card, TextInput } from '../../../components/ui';
import { ErrorBanner, TableWrap, Td, Th } from '../../../components/admin';

/* ------------------------------- tipe data ------------------------------- */

interface Summary {
  sessionId: string;
  session: {
    id: string;
    title: string;
    examId: string;
    examTitle: string;
    mapel: string | null;
    status: string;
    resultsPublished: boolean;
  };
  kkm: number;
  questionCount: number;
  maxScore: number;
  summary: {
    total: number;
    inProgress: number;
    finished: number;
    graded: number;
    pendingReview: number;
    passCount: number;
    failCount: number;
    avgScore: number;
    avgPercent: number;
    maxScore: number;
    minScore: number;
    highest: number;
    lowest: number;
    distribution: Array<{ label: string; count: number }>;
  };
}

interface ResultItem {
  questionId: string;
  type: string;
  weight: number;
  score: number;
  autoScore: number;
  reviewedScore: number | null;
  isCorrect: boolean | null;
  needsReview: boolean;
}

interface Results {
  kkm: number;
  data: ResultRow[];
}

interface ResultRow {
  attemptId: string;
  user: { id: string; name: string; username: string; nisn: string | null; kelas: { name: string } | null };
  status: string;
  submittedAt: string | null;
  violationCount: number;
  score: number;
  maxScore: number;
  percent: number;
  pendingReview: number;
  items: ResultItem[];
}

interface ReviewRow {
  attemptId: string;
  questionId: string;
  answer: string;
  maxScore: number;
  question: { id: string; content: string };
  acceptedAnswers: string[];
  user: { id: string; name: string; username: string; nisn: string | null; kelas: { name: string } | null };
}

interface AnalysisRow {
  order: number;
  questionId: string;
  type: string;
  content: string;
  scoringMode: string;
  weight: number;
  answered: number;
  blank: number;
  correct: number;
  difficulty: number;
  difficultyLabel: 'MUDAH' | 'SEDANG' | 'SULIT';
  discrimination: number | null;
  discriminationLabel: string;
  avgScore: number;
  avgPercent: number;
  choices: Array<{ id: string; label: string; isKey: boolean; picked: number }>;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draf',
  SCHEDULED: 'Terjadwal',
  ACTIVE: 'Aktif',
  CLOSED: 'Selesai',
  IN_PROGRESS: 'Mengerjakan',
  SUBMITTED: 'Dikumpulkan',
  EXPIRED: 'Waktu habis',
  FORCE_SUBMITTED: 'Dikumpulkan paksa',
};

const DIFFICULTY_TONE: Record<string, string> = {
  MUDAH: 'border-emerald-500/40 text-emerald-600 dark:text-emerald-300',
  SEDANG: 'border-brand-500/40 text-brand-600 dark:text-brand-300',
  SULIT: 'border-red-500/40 text-red-500',
};

const DISCRIMINATION_TONE: Record<string, string> = {
  BAIK: 'border-emerald-500/40 text-emerald-600 dark:text-emerald-300',
  CUKUP: 'border-brand-500/40 text-brand-600 dark:text-brand-300',
  LEMAH: 'border-amber-500/40 text-amber-600 dark:text-amber-300',
  BURUK: 'border-red-500/40 text-red-500',
  BELUM_CUKUP_DATA: 'border-slate-400/40 text-slate-500 dark:text-slate-400',
};

const TYPE_LABEL: Record<string, string> = {
  PG: 'PG',
  PG_KOMPLEKS: 'PG kompleks',
  MATCHING: 'Matching',
  BENAR_SALAH: 'Benar–salah',
  ISIAN_SINGKAT: 'Isian singkat',
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const truncate = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n)}…` : s);

/* -------------------------------- halaman ------------------------------- */

export function SessionGrading() {
  const { id } = useParams();
  const [tab, setTab] = useState<'peserta' | 'review' | 'analisis'>('peserta');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [kkm, setKkm] = useState(75);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [scores, setScores] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const s = await apiFetch<Summary>(`/sessions/${id}/grading`);
      setSummary(s);
      setKkm(typeof s.kkm === 'number' ? s.kkm : 75);
      const [res, rev, ana] = await Promise.all([
        apiFetch<Results>(`/sessions/${id}/results`),
        apiFetch<{ data: ReviewRow[] }>(`/sessions/${id}/reviews`).catch(() => ({ data: [] as ReviewRow[] })),
        apiFetch<{ data: AnalysisRow[] }>(`/sessions/${id}/item-analysis`).catch(() => ({ data: [] as AnalysisRow[] })),
      ]);
      setResults(res.data);
      setReviews(rev.data);
      setAnalysis(ana.data);
      setScores((prev) => {
        const next = { ...prev };
        for (const r of rev.data) next[`${r.attemptId}:${r.questionId}`] ??= '';
        return next;
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal memuat penilaian');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function regrade() {
    if (!id) return;
    setBusy('grade');
    setError('');
    setOk('');
    try {
      const res = await apiFetch<{ graded: number; pendingReview: number }>(`/sessions/${id}/grade`, { method: 'POST' });
      setOk(`${res.graded} attempt dinilai ulang.`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal menilai');
    } finally {
      setBusy('');
    }
  }

  async function togglePublish() {
    if (!id || !summary) return;
    const next = !summary.session.resultsPublished;
    if (next && !window.confirm('Terbitkan hasil ke siswa? Pastikan semua review sudah selesai.')) return;
    setBusy('publish');
    setError('');
    setOk('');
    try {
      await apiFetch(`/sessions/${id}/publish`, { method: 'POST', body: JSON.stringify({ published: next }) });
      setOk(next ? 'Hasil diterbitkan — siswa hanya melihat pengumuman (nilai tidak tampil di aplikasi).' : 'Hasil ditarik kembali.');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal mengubah status publish');
    } finally {
      setBusy('');
    }
  }

  async function downloadNilai() {
    if (!id) return;
    setBusy('nilai');
    setError('');
    try {
      await apiDownload(`/sessions/${id}/export/nilai`, `nilai-${id}.xlsx`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal mengunduh rekap nilai');
    } finally {
      setBusy('');
    }
  }

  async function saveReview(row: ReviewRow) {
    const key = `${row.attemptId}:${row.questionId}`;
    const raw = scores[key];
    const score = Number(raw);
    if (raw === '' || Number.isNaN(score)) {
      setError('Isi skor review dulu (boleh 0).');
      return;
    }
    setBusy(key);
    setError('');
    setOk('');
    try {
      await apiFetch(`/attempts/${row.attemptId}/review`, {
        method: 'POST',
        // Jangan kirim jawaban siswa sebagai catatan — kolom note untuk
        // keterangan guru, bukan salinan jawaban (rawan limit/XSS tersimpan).
        body: JSON.stringify({ questionId: row.questionId, score }),
      });
      setOk(`Skor ${row.user.name} disimpan.`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal menyimpan review');
    } finally {
      setBusy('');
    }
  }

  if (loading && !summary) return <p className="py-8 text-center text-sm text-slate-500">Memuat penilaian…</p>;
  if (!summary) return <ErrorBanner message={error || 'Sesi tidak ditemukan'} />;

  const s = summary.summary;
  const maxDist = Math.max(1, ...s.distribution.map((d) => d.count));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h1 className="text-xl font-extrabold">Penilaian — {summary.session.title}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              <Link to={`/app/guru/ujian/${summary.session.examId}`} className="font-bold text-brand-500">
                {summary.session.examTitle}
              </Link>
              {summary.session.mapel ? ` · ${summary.session.mapel}` : ''} · {summary.questionCount} soal · total bobot{' '}
              {summary.maxScore}
            </p>
          </div>
          <Badge>{STATUS_LABEL[summary.session.status] ?? summary.session.status}</Badge>
          <Badge
            className={
              summary.session.resultsPublished
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300'
            }
          >
            {summary.session.resultsPublished ? 'Hasil terbit' : 'Hasil belum terbit'}
          </Badge>
          <Link to={`/app/proktor/sesi/${summary.sessionId}/pengaturan`}>
            <Button type="button" variant="ghost">
              Pengaturan sesi
            </Button>
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          <div className="rounded-xl bg-slate-500/5 px-3 py-2 dark:bg-white/5">
            <p className="text-xs text-slate-500 dark:text-slate-400">Sudah selesai</p>
            <p className="text-lg font-extrabold">
              {s.finished}/{s.total}
            </p>
          </div>
          <div className="rounded-xl bg-slate-500/5 px-3 py-2 dark:bg-white/5">
            <p className="text-xs text-slate-500 dark:text-slate-400">Rata-rata</p>
            <p className="text-lg font-extrabold">
              {s.avgScore} <span className="text-xs font-semibold text-slate-500">({s.avgPercent}%)</span>
            </p>
          </div>
          <div className="rounded-xl bg-slate-500/5 px-3 py-2 dark:bg-white/5">
            <p className="text-xs text-slate-500 dark:text-slate-400">Tertinggi / terendah</p>
            <p className="text-lg font-extrabold">
              {s.maxScore} / {s.minScore}
            </p>
          </div>
          <div className="rounded-xl bg-slate-500/5 px-3 py-2 dark:bg-white/5">
            <p className="text-xs text-slate-500 dark:text-slate-400">Perlu review</p>
            <p className={`text-lg font-extrabold ${s.pendingReview > 0 ? 'text-amber-600 dark:text-amber-300' : ''}`}>
              {s.pendingReview}
            </p>
          </div>
          <div className="rounded-xl bg-slate-500/5 px-3 py-2 dark:bg-white/5" title="KKM mapel — atur di menu KKM Mapel">
            <p className="text-xs text-slate-500 dark:text-slate-400">Lulus (KKM {kkm})</p>
            <p className="text-lg font-extrabold">
              {s.passCount}<span className="text-xs font-semibold text-slate-500"> / {s.graded}</span>
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="ghost" onClick={regrade} disabled={busy === 'grade'}>
            {busy === 'grade' ? 'Menilai…' : 'Nilai ulang otomatis'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={downloadNilai}
            disabled={busy === 'nilai' || s.pendingReview > 0}
            title={
              s.pendingReview > 0
                ? `Masih ada ${s.pendingReview} isian singkat yang belum dinilai — selesaikan review dulu`
                : 'Unduh rekap nilai (Excel) untuk dibagikan ke siswa'
            }
          >
            {busy === 'nilai' ? 'Mengunduh…' : 'Unduh nilai (Excel)'}
          </Button>
          <Button
            type="button"
            variant={summary.session.resultsPublished ? 'ghost' : 'gold'}
            onClick={togglePublish}
            disabled={busy === 'publish' || (!summary.session.resultsPublished && s.finished < s.total)}
            title={!summary.session.resultsPublished && s.finished < s.total ? `Masih ada ${s.total - s.finished} peserta yang belum selesai` : undefined}
          >
            {busy === 'publish' ? 'Menyimpan…' : summary.session.resultsPublished ? 'Tarik hasil' : 'Terbitkan hasil'}
          </Button>
          {!summary.session.resultsPublished && s.finished < s.total ? (
            <p className="self-center text-xs text-slate-500 dark:text-slate-400">
              Publish hanya bisa setelah semua peserta selesai ({s.finished}/{s.total}).
            </p>
          ) : null}
          {s.pendingReview > 0 ? (
            <p className="self-center text-xs font-semibold text-amber-600 dark:text-amber-400">
              Export nilai terkunci — selesaikan {s.pendingReview} review isian singkat dulu (tab Review).
            </p>
          ) : (
            <p className="self-center text-xs text-slate-500 dark:text-slate-400">Nilai tidak tampil di aplikasi siswa — bagikan lewat Excel.</p>
          )}
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Sebaran nilai (persen)
          </p>
          <div className="flex items-end gap-3">
            {s.distribution.map((d) => (
              <div key={d.label} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs font-bold">{d.count}</span>
                <div
                  className="w-full rounded-t-lg bg-gradient-to-t from-brand-600 to-brand-400"
                  style={{ height: `${Math.max(4, (d.count / maxDist) * 64)}px` }}
                />
                <span className="text-[10px] text-slate-500 dark:text-slate-400">{d.label}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <ErrorBanner message={error} onClose={() => setError('')} />
      {ok ? (
        <p className="rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-600 dark:text-emerald-300">
          {ok}
        </p>
      ) : null}

      <div className="flex gap-2">
        {(
          [
            ['peserta', `Peserta (${results.length})`],
            ['review', `Review manual (${reviews.length})`],
            ['analisis', `Analisis butir (${analysis.length})`],
          ] as const
        ).map(([key, label]) => (
          <Button key={key} type="button" variant={tab === key ? 'primary' : 'ghost'} onClick={() => setTab(key)}>
            {label}
          </Button>
        ))}
      </div>

      {tab === 'peserta' ? (
        <Card>
          <h2 className="mb-3 font-extrabold">Hasil per peserta</h2>
          {results.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Belum ada peserta yang mengerjakan.</p>
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Nama</Th>
                  <Th>Kelas</Th>
                  <Th>Status</Th>
                  <Th>Skor</Th>
                  <Th>Persen</Th>
                  <Th>KKM</Th>
                  <Th>Ketuntasan</Th>
                  <Th>Pelanggaran</Th>
                  <Th>Review</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <Fragment key={r.attemptId}>
                    <tr>
                      <Td>
                        <span className="font-semibold">{r.user.name}</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          {r.user.nisn ?? r.user.username}
                        </span>
                      </Td>
                      <Td>{r.user.kelas?.name ?? '—'}</Td>
                      <Td>{STATUS_LABEL[r.status] ?? r.status}</Td>
                      <Td>
                        <b>{r.score}</b>
                        <span className="text-xs text-slate-500"> / {r.maxScore}</span>
                      </Td>
                      <Td>{r.percent}%</Td>
                      <Td>{kkm}</Td>
                      <Td>
                        {r.status === 'IN_PROGRESS' ? (
                          '—'
                        ) : r.percent >= kkm ? (
                          <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">LULUS</Badge>
                        ) : (
                          <Badge className="border-red-500/40 bg-red-500/10 text-red-500">TIDAK</Badge>
                        )}
                      </Td>
                      <Td className={r.violationCount > 0 ? 'text-amber-600 dark:text-amber-300' : ''}>
                        {r.violationCount}
                      </Td>
                      <Td>{r.pendingReview > 0 ? <Badge>{r.pendingReview} butir</Badge> : '—'}</Td>
                      <Td>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setOpen(open === r.attemptId ? null : r.attemptId)}
                        >
                          {open === r.attemptId ? 'Tutup' : 'Rincian'}
                        </Button>
                      </Td>
                    </tr>
                    {open === r.attemptId ? (
                      <tr>
                        <td
                          colSpan={10}
                          className="border-b border-slate-100 bg-slate-500/5 px-4 py-3 dark:border-white/5 dark:bg-white/5"
                        >
                          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                            Dikumpulkan: {fmt(r.submittedAt)} · hijau = benar, merah = salah, kuning = perlu review
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {r.items.map((it, i) => (
                              <span
                                key={it.questionId}
                                title={`${TYPE_LABEL[it.type] ?? it.type} · skor ${it.score}/${it.weight}${
                                  it.reviewedScore !== null ? ' (review guru)' : ''
                                }`}
                                className={`inline-flex h-7 min-w-7 items-center justify-center rounded-lg border px-1.5 text-xs font-bold ${
                                  it.needsReview
                                    ? 'border-amber-500/50 text-amber-600 dark:text-amber-300'
                                    : it.isCorrect
                                      ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-300'
                                      : 'border-red-500/30 text-red-500'
                                }`}
                              >
                                {i + 1}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      ) : null}

      {tab === 'review' ? (
        <Card>
          <h2 className="font-extrabold">Review manual — isian singkat</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Jawaban yang tidak cocok dengan kunci mana pun dinilai 0 otomatis. Beri skor manual (0 – bobot soal) bila
            jawaban siswa sebenarnya benar.
          </p>
          {reviews.length === 0 ? (
            <p className="mt-3 rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-600 dark:text-emerald-300">
              Tidak ada jawaban yang menunggu review.
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              {reviews.map((r) => {
                const key = `${r.attemptId}:${r.questionId}`;
                return (
                  <div
                    key={key}
                    className="rounded-xl border border-slate-200/80 p-3 dark:border-white/10"
                  >
                    <p className="text-sm font-semibold">
                      {r.user.name} <span className="text-xs text-slate-500">· {r.user.kelas?.name ?? '—'}</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{truncate(r.question.content, 140)}</p>
                    <p className="mt-2 text-sm">
                      Jawaban siswa: <b className="text-brand-600 dark:text-brand-300">{r.answer || '(kosong)'}</b>
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Kunci: {r.acceptedAnswers.join(' | ') || '—'} · bobot {r.maxScore}
                    </p>
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <TextInput
                        id={`skor-${key}`}
                        label="Skor"
                        type="number"
                        min={0}
                        max={r.maxScore}
                        step="0.5"
                        value={scores[key] ?? ''}
                        onChange={(e) => setScores((prev) => ({ ...prev, [key]: e.target.value }))}
                        className="w-28"
                      />
                      <Button type="button" onClick={() => saveReview(r)} disabled={busy === key}>
                        {busy === key ? 'Menyimpan…' : 'Simpan skor'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setScores((prev) => ({ ...prev, [key]: '0' }))}
                        title="Tandai jawaban ini salah (skor 0)"
                      >
                        Terima nilai 0
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : null}

      {tab === 'analisis' ? (
        <Card>
          <h2 className="font-extrabold">Analisis butir soal</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Kesulitan = proporsi peserta yang benar (makin tinggi makin mudah). Daya pembeda dihitung dari selisih
            kelompok atas/bawah 27%; nilai &lt; 0,2 berarti butir perlu diperbaiki.
          </p>
          {analysis.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Belum ada data untuk dianalisis.</p>
          ) : (
            <div className="mt-3">
              <TableWrap>
                <thead>
                  <tr>
                    <Th>#</Th>
                    <Th>Soal</Th>
                    <Th>Tipe</Th>
                    <Th>Bobot</Th>
                    <Th>Benar</Th>
                    <Th>Kesulitan</Th>
                    <Th>Daya pembeda</Th>
                    <Th>Rata-rata</Th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.map((a) => (
                    <tr key={a.questionId}>
                      <Td>{a.order}</Td>
                      <Td>
                        <span>{truncate(a.content)}</span>
                        {a.choices.length > 0 ? (
                          <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                            {a.choices
                              .map((c) => `${c.id}${c.isKey ? '✓' : ''}: ${c.picked}`)
                              .join(' · ')}
                          </span>
                        ) : null}
                      </Td>
                      <Td>{TYPE_LABEL[a.type] ?? a.type}</Td>
                      <Td>{a.weight}</Td>
                      <Td>
                        {a.correct}/{a.answered}
                        {a.blank > 0 ? (
                          <span className="block text-xs text-slate-500 dark:text-slate-400">{a.blank} kosong</span>
                        ) : null}
                      </Td>
                      <Td>
                        <Badge className={DIFFICULTY_TONE[a.difficultyLabel] ?? ''}>
                          {a.difficulty.toFixed(2)} {a.difficultyLabel}
                        </Badge>
                      </Td>
                      <Td>
                        <Badge className={DISCRIMINATION_TONE[a.discriminationLabel] ?? ''}>
                          {a.discrimination === null ? '—' : a.discrimination.toFixed(2)} {a.discriminationLabel}
                        </Badge>
                      </Td>
                      <Td>
                        {a.avgScore} ({a.avgPercent}%)
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}

export default SessionGrading;
