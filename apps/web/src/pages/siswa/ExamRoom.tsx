import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Flag, Loader2, Lock, LockOpen, Send } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import type { IntegrityType } from '@cbt/shared';
import { Button, Logo, TextInput, cn } from '../../components/ui';
import { ApiError, apiFetch } from '../../lib/api';
import { isSebClient, sebAlarm } from '../../lib/seb';
import { playAlarm } from '../../lib/alarm';
import { connectMonitor, disconnectMonitor } from '../../lib/monitor';
import { useAuth } from '../../auth/AuthContext';
import { QuestionEditor } from './QuestionRenderer';
import { UploadImg } from '../../components/UploadImg';
import type { ExamQuestion } from './QuestionRenderer';

interface AttemptState {
  /** true = attempt terkunci (batas pelanggaran) — soal/jawaban tidak dikirim server. */
  locked?: boolean;
  attempt: {
    id: string;
    status: 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED' | 'FORCE_SUBMITTED';
    startedAt: string;
    expiresAt: string;
    submittedAt: string | null;
    violationCount: number;
    sebVerified: boolean;
    score: number | null;
    lockedAt?: string | null;
  };
  session: {
    id: string;
    title: string;
    exam: { id: string; title: string };
    mapel: string | null;
    durationMin: number;
    maxViolations: number;
    requireSeb: boolean;
    resultsPublished: boolean;
  };
  questions: ExamQuestion[];
  answers: Array<{ questionId: string; payload: unknown; isFlagged: boolean }>;
  serverTime: string;
  remainingSec: number;
}

const isBenarSalah = (v: unknown): v is Record<string, boolean> => typeof v === 'object' && v !== null;

function isAnswered(type: ExamQuestion['type'], v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (type === 'PG') return typeof v === 'string' && v.length > 0;
  if (type === 'PG_KOMPLEKS') return Array.isArray(v) && v.length > 0;
  if (type === 'BENAR_SALAH')
    return isBenarSalah(v) && Object.keys(v).length > 0;
  if (type === 'MATCHING') return isBenarSalah(v) && Object.keys(v).length > 0;
  return typeof v === 'string' && v.trim().length > 0;
}

function fmt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export default function ExamRoom() {
  const { attemptId = '' } = useParams();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [state, setState] = useState<AttemptState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [flagged, setFlagged] = useState<Record<string, boolean>>({});
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [violations, setViolations] = useState(0);
  const [notice, setNotice] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [locked, setLocked] = useState(false);
  const [kicked, setKicked] = useState(false);
  const [unlockToken, setUnlockToken] = useState('');
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState('');
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const offsetRef = useRef(0);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const submittedRef = useRef(false);
  // Cermin ref agar handler socket (dipasang sekali) selalu membaca jawaban
  // terbaru saat flush, bukan closure basi dari render pertama.
  const answersRef = useRef<Record<string, unknown>>({});
  const flaggedRef = useRef<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState('');

  const isSeb = useMemo(() => isSebClient(), []);

  /* --------------------------- load state --------------------------- */
  const applyState = useCallback((s: AttemptState) => {
    setState(s);
    setRemaining(s.remainingSec);
    setViolations(s.attempt.violationCount);
    setLocked(Boolean(s.locked));
    if (s.locked) return; // soal tidak dikirim server saat terkunci
    offsetRef.current = Date.now() - new Date(s.serverTime).getTime();
    setAnswers((prev) => {
      const next: Record<string, unknown> = { ...prev };
      for (const a of s.answers) next[a.questionId] = a.payload;
      answersRef.current = next;
      return next;
    });
    setFlagged((prev) => {
      const next: Record<string, boolean> = { ...prev };
      for (const a of s.answers) if (a.isFlagged) next[a.questionId] = true;
      flaggedRef.current = next;
      return next;
    });
    if (s.attempt.status !== 'IN_PROGRESS') {
      submittedRef.current = true;
      setDone(true);
    }
  }, []);

  useEffect(() => {
    apiFetch<AttemptState>(`/attempts/${attemptId}`)
      .then(applyState)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Gagal memuat ujian'))
      .finally(() => setLoading(false));
  }, [attemptId, applyState]);

  /* ------- terkunci (batas pelanggaran): alarm + paksa logout ------- */
  // Dipicu saat server mencatat pelanggaran ke-N (respons integrity). Layar
  // dikunci + alarm panjang ±4 dtk, lalu siswa DIKELUARKAN ke halaman login.
  // Untuk membuka lagi, siswa minta token ke proktor (gerbang di bawahnya).
  const triggerLocked = useCallback(() => {
    setLocked((prev) => {
      if (prev) return prev;
      playAlarm(true);
      setKicked(true);
      lockTimer.current = setTimeout(() => {
        logout();
        void navigate('/login', {
          state: {
            notice:
              'Ujian Anda TERKUNCI karena batas pelanggaran terlampaui. Jawaban tersimpan aman di server — minta token kepada proktor untuk membuka kembali.',
          },
        });
      }, 4200);
      return true;
    });
  }, [logout, navigate]);

  useEffect(
    () => () => {
      if (lockTimer.current) clearTimeout(lockTimer.current);
    },
    [],
  );

  /* ----------------------------- timer ------------------------------ */
  useEffect(() => {
    if (!state || done) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((new Date(state.attempt.expiresAt).getTime() - (Date.now() - offsetRef.current)) / 1000));
      setRemaining(left);
      if (left <= 0 && !submittedRef.current) void submit('TIMEOUT', true);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, done]);

  /* --------------------------- anti-cheat --------------------------- */
  const logIntegrity = useCallback(
    async (type: IntegrityType, detail?: Record<string, unknown>) => {
      if (!attemptId || submittedRef.current || locked) return;
      // Alarm pelanggaran: APK (SebBridge → ringtone stream ALARM) dan browser
      // (Web Audio) — semua pelanggaran bikin siswa menyadarinya.
      sebAlarm(type);
      playAlarm();
      try {
        const res = await apiFetch<{ violationCount: number; maxViolations?: number; forcedSubmitted: boolean; locked?: boolean }>(
          `/attempts/${attemptId}/integrity`,
          { method: 'POST', body: JSON.stringify({ type, detail }) },
        );
        setViolations(res.violationCount);
        if (res.locked) {
          triggerLocked();
          return;
        }
        if (res.forcedSubmitted) {
          submittedRef.current = true;
          setState((prev) =>
            prev ? { ...prev, attempt: { ...prev.attempt, status: 'FORCE_SUBMITTED' as const, violationCount: res.violationCount } } : prev,
          );
          setNotice('Batas pelanggaran terlampaui — ujian otomatis dikumpulkan.');
          setDone(true);
        } else {
          setNotice(
            `Peringatan pelanggaran (${res.violationCount}/${state?.session.maxViolations ?? '?'}): Anda melanggar — tetap di layar ujian!`,
          );
        }
      } catch {
        // abaikan kegagalan pencatatan
      }
    },
    [attemptId, state?.session.maxViolations, locked, triggerLocked],
  );

  useEffect(() => {
    if (!state || done) return;
    const onVisibility = () => {
      if (document.hidden) void logIntegrity('TAB_SWITCH');
    };
    const onBlur = () => void logIntegrity('WINDOW_BLUR');
    const onAppHidden = () => void logIntegrity('WINDOW_BLUR', { source: 'apphidden' });
    const onFs = () => {
      if (!document.fullscreenElement) void logIntegrity('FULLSCREEN_EXIT');
    };
    const block = (t: IntegrityType) => (e: Event) => {
      e.preventDefault();
      void logIntegrity(t);
    };
    const onCopy = block('COPY_ATTEMPT');
    const onPaste = block('PASTE_ATTEMPT');
    const onContext = block('CONTEXT_MENU');

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('cbt:apphidden', onAppHidden);
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    document.addEventListener('contextmenu', onContext);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('cbt:apphidden', onAppHidden);
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('contextmenu', onContext);
    };
  }, [state, done, logIntegrity]);

  /* ---------------------------- autosave ---------------------------- */
  const saveAnswer = useCallback(
    async (questionId: string, payload: unknown, isFlaggedOverride?: boolean, omitPayload = false) => {
      setSaving(true);
      try {
        // Payload boleh dihilangkan sama sekali (klien hanya mengubah tanda
        // "ragu-ragu") — mengirim `payload: null` akan menolak validasi server
        // untuk tipe non-PG / menimpa jawaban tersimpan dengan null.
        const body: Record<string, unknown> = {
          questionId,
          isFlagged: isFlaggedOverride ?? flaggedRef.current[questionId] ?? false,
        };
        if (!omitPayload) body.payload = payload;
        await apiFetch(`/attempts/${attemptId}/answers`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        setSaveError('');
      } catch {
        // Jangan diam: siswa harus tahu jawabannya BELUM tersimpan.
        setSaveError('Gagal menyimpan jawaban — periksa koneksi, jawaban akan dicoba lagi saat ada perubahan.');
      } finally {
        setSaving(false);
      }
    },
    [attemptId],
  );

  const onAnswer = (questionId: string, payload: unknown) => {
    setAnswers((prev) => {
      const next = { ...prev, [questionId]: payload };
      answersRef.current = next;
      return next;
    });
    clearTimeout(timers.current[questionId]);
    timers.current[questionId] = setTimeout(() => void saveAnswer(questionId, payload), 600);
  };

  const toggleFlag = (questionId: string) => {
    const next = !flaggedRef.current[questionId];
    setFlagged((prev) => {
      const upd = { ...prev, [questionId]: next };
      flaggedRef.current = upd;
      return upd;
    });
    // Tanpa jawaban (mis. soal non-PG belum diisi): kirim flag saja, bukan null payload.
    const hasAnswer = questionId in answersRef.current && answersRef.current[questionId] !== undefined;
    void saveAnswer(questionId, answersRef.current[questionId], next, !hasAnswer);
  };

  // Kirim semua jawaban yang masih tertunda di debounce (best-effort) — dipakai
  // sebelum submit/force-submit dan saat meninggalkan ruangan agar jawaban
  // ≤600ms terakhir tidak hilang.
  const flushPending = useCallback(async () => {
    const pending = Object.keys(timers.current);
    for (const t of Object.values(timers.current)) clearTimeout(t);
    timers.current = {};
    await Promise.allSettled(
      pending.map((qid) => {
        // Jawaban yang memang belum ada: kirim flag saja, bukan payload null.
        const hasAnswer = qid in answersRef.current && answersRef.current[qid] !== undefined;
        const body: Record<string, unknown> = {
          questionId: qid,
          isFlagged: flaggedRef.current[qid] ?? false,
        };
        if (hasAnswer) body.payload = answersRef.current[qid];
        return apiFetch(`/attempts/${attemptId}/answers`, {
          method: 'PUT',
          body: JSON.stringify(body),
        }).catch(() => undefined);
      }),
    );
  }, [attemptId]);

  /* ----------------------------- submit ----------------------------- */
  const submit = useCallback(
    async (reason: 'MANUAL' | 'TIMEOUT' | 'FORCED' = 'MANUAL', silent = false) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      try {
        // Kirim dulu jawaban yang masih di debounce — kalau tidak, ketikan
        // ≤600ms terakhir hilang saat dikumpulkan (manual maupun timeout).
        await flushPending();
        await apiFetch(`/attempts/${attemptId}/submit`, { method: 'POST', body: JSON.stringify({ reason }) });
        setState((prev) =>
          prev ? { ...prev, attempt: { ...prev.attempt, status: 'SUBMITTED' as const } } : prev,
        );
        if (!silent) setNotice('Ujian berhasil dikumpulkan.');
        setDone(true);
      } catch (e) {
        submittedRef.current = false;
        setNotice(e instanceof ApiError ? e.message : 'Gagal mengumpulkan ujian');
      } finally {
        setSubmitting(false);
        setConfirmOpen(false);
      }
    },
    [attemptId, flushPending],
  );

  // Kirim jawaban yang masih tertunda saat keluar ruangan (flushPending
  // sendiri membersihkan debounce).
  useEffect(
    () => () => {
      void flushPending();
    },
    [flushPending],
  );

  /* ------------------ realtime (Fase 6): warn & kendali ------------------ */
  // Ditaruh setelah submit/flushPending agar deps tidak menyentuh const yang
  // belum diinisialisasi (TDZ) saat render.
  useEffect(() => {
    if (!attemptId) return;
    const s = connectMonitor();
    const join = () => s.emit('attempt:join', attemptId, () => undefined);
    const heartbeat = () => {
      if (s.connected) s.emit('attempt:heartbeat', attemptId, () => undefined);
    };
    const onWarn = (payload: { message?: string }) => {
      setNotice(`Peringatan dari proktor: ${payload?.message ?? 'perhatikan fokus Anda.'}`);
    };
    const onControl = (payload: { type?: string; expiresAt?: string; reason?: string }) => {
      if (payload?.type === 'extend' && payload.expiresAt) {
        setState((prev) => (prev ? { ...prev, attempt: { ...prev.attempt, expiresAt: payload.expiresAt! } } : prev));
        setNotice('Waktu pengerjaan Anda diperpanjang oleh proktor.');
      } else if (payload?.type === 'force-submit') {
        if (submittedRef.current) return;
        // Flush dulu jawaban tertunda, lalu sinkronkan ke server lewat submit
        // (idempoten — server sudah FORCE_SUBMITTED, submit mengembalikan state).
        setState((prev) =>
          prev ? { ...prev, attempt: { ...prev.attempt, status: 'FORCE_SUBMITTED' as const } } : prev,
        );
        setNotice(payload.reason ?? 'Ujian dikumpulkan oleh proktor.');
        void flushPending().finally(() => void submit('FORCED', true));
      }
    };

    s.on('connect', join);
    s.on('warn', onWarn);
    s.on('attempt:control', onControl);
    if (s.connected) {
      join();
      heartbeat();
    }
    const hb = setInterval(heartbeat, 25_000);

    return () => {
      clearInterval(hb);
      s.off('connect', join);
      s.off('warn', onWarn);
      s.off('attempt:control', onControl);
      disconnectMonitor();
    };
  }, [attemptId, flushPending, submit]);

  /* ------------------------------ render ---------------------------- */
  if (loading) {
    return (
      <div className="bg-scene flex min-h-screen items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  if (error || !state) {
    return (
      <div className="bg-scene flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg font-bold">{error || 'Ujian tidak ditemukan'}</p>
        <Button variant="ghost" onClick={() => navigate('/app/siswa')}>
          Kembali ke daftar ujian
        </Button>
      </div>
    );
  }

  /* ------- layar terkunci (batas pelanggaran): alarm + gerbang token ------- */
  if (locked) {
    const kickedNow = kicked;
    const submitUnlock = async (e: { preventDefault(): void }) => {
      e.preventDefault();
      if (unlockBusy || unlockToken.length !== 6) return;
      setUnlockBusy(true);
      setUnlockError('');
      try {
        const resp = await apiFetch<AttemptState>(`/attempts/${attemptId}/unlock`, {
          method: 'POST',
          body: JSON.stringify({ token: unlockToken }),
        });
        applyState(resp);
        setKicked(false);
        setUnlockToken('');
        setNotice('Ujian dibuka kembali oleh proktor — tetap fokus.');
      } catch (err) {
        setUnlockError(err instanceof ApiError ? err.message : 'Token salah atau gagal membuka — coba lagi.');
      } finally {
        setUnlockBusy(false);
      }
    };

    return (
      <div className="bg-scene flex min-h-screen items-center justify-center p-5">
        <div className="glass max-w-md p-8 text-center">
          <div className="mx-auto flex h-20 w-20 animate-pulse items-center justify-center rounded-full bg-red-500/15">
            <Lock size={36} className="text-red-400" />
          </div>
          <h1 className="mt-4 text-2xl font-extrabold text-red-400">UJIAN TERKUNCI</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Batas pelanggaran terlampaui ({violations}
            {state?.session.maxViolations ? `/${state.session.maxViolations}` : ''} pelanggaran).
            Jawaban Anda <b>tersimpan aman</b> di server — tidak ada yang hilang.
          </p>
          {kickedNow ? (
            <p className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-400">
              Alarm pelanggaran masih berbunyi. Anda akan dikeluarkan ke halaman login —
              minta token kepada proktor untuk membuka kembali.
            </p>
          ) : (
            <form onSubmit={submitUnlock} className="mt-6 flex flex-col gap-3">
              <p className="text-sm">Masukkan <b>token 6 digit</b> dari proktor:</p>
              <TextInput
                label="Token proktor"
                id="unlock-token"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="• • • • • •"
                value={unlockToken}
                onChange={(e) => setUnlockToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
              {unlockError ? <p className="text-sm font-medium text-red-400">{unlockError}</p> : null}
              <Button type="submit" variant="gold" disabled={unlockBusy || unlockToken.length !== 6}>
                {unlockBusy ? (
                  'Membuka…'
                ) : (
                  <>
                    <LockOpen size={16} /> BUKA & LANJUTKAN UJIAN
                  </>
                )}
              </Button>
            </form>
          )}
          <p className="mt-4 text-xs text-slate-500">
            {kickedNow ? null : 'Ujian tetap berjalan — waktu tersisa tetap dihitung.'}
          </p>
        </div>
      </div>
    );
  }

  if (done) {
    const submitted = state.attempt.status !== 'IN_PROGRESS';
    return (
      <div className="bg-scene flex min-h-screen items-center justify-center p-6">
        <div className="glass max-w-lg p-8 text-center">
          <Logo size={64} />
          <h1 className="mt-4 text-2xl font-extrabold">Ujian dikumpulkan</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {notice || 'Jawaban Anda sudah tersimpan.'}
          </p>
          {submitted && !state.session.resultsPublished ? (
            <p className="mt-1 text-xs text-slate-400">Nilai tidak tampil di aplikasi — guru mapel membagikan nilai langsung.</p>
          ) : null}
          <Button className="mt-6" onClick={() => navigate('/app/siswa')}>
            Kembali ke daftar ujian
          </Button>
        </div>
      </div>
    );
  }

  const q = state.questions[index];
  const answeredCount = state.questions.filter((item) => isAnswered(item.type, answers[item.id])).length;

  return (
    <div className="bg-scene min-h-screen select-none">
      {/* Header ujian */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur-xl dark:border-white/10 dark:bg-ink-950/80">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Logo size={36} />
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold">{state.session.title}</p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {state.session.mapel ?? state.session.exam.title} · {answeredCount}/{state.questions.length} dijawab
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {saving ? <span className="text-xs text-slate-400">menyimpan…</span> : null}
            {saveError ? <span className="max-w-56 text-right text-xs font-semibold text-red-500">{saveError}</span> : null}
            <div
              className={cn(
                'rounded-xl px-4 py-2 font-mono text-lg font-bold tabular-nums',
                remaining < 300 ? 'bg-red-500/15 text-red-500' : 'bg-brand-500/15 text-brand-600 dark:text-brand-200',
              )}
            >
              {fmt(remaining)}
            </div>
            <Button variant="gold" onClick={() => setConfirmOpen(true)} disabled={submitting}>
              <Send size={16} /> Kumpulkan
            </Button>
          </div>
        </div>
        {notice ? (
          <div className="bg-amber-500/15 px-4 py-2 text-center text-xs font-semibold text-amber-700 dark:text-amber-300">
            {notice} (pelanggaran: {violations}
            {state.session.maxViolations ? `/${state.session.maxViolations}` : ''})
          </div>
        ) : null}
        {state.session.requireSeb && !isSeb && !state.attempt.sebVerified ? (
          <div className="bg-red-500/15 px-4 py-2 text-center text-xs font-semibold text-red-500">
            Mode SEB tidak terdeteksi — hubungi proktor.
          </div>
        ) : null}
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 p-4 md:grid-cols-[1fr_260px]">
        {/* Soal */}
        <div className="glass p-6">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-bold text-slate-500 dark:text-slate-400">
              Soal {index + 1} dari {state.questions.length}
            </span>
            <button
              type="button"
              onClick={() => toggleFlag(q.id)}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold transition',
                flagged[q.id] ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300',
              )}
            >
              <Flag size={14} /> {flagged[q.id] ? 'Ditandai ragu' : 'Tandai ragu'}
            </button>
          </div>
          <p className="mb-4 whitespace-pre-wrap text-base font-medium leading-relaxed">{q.content}</p>
          {q.imageUrl ? <UploadImg src={q.imageUrl} alt="" className="mb-4 max-h-72 rounded-xl" /> : null}
          <QuestionEditor question={q} value={answers[q.id]} onChange={(p) => onAnswer(q.id, p)} />

          <div className="mt-6 flex items-center justify-between">
            <Button variant="ghost" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
              ← Sebelumnya
            </Button>
            {index === state.questions.length - 1 ? (
              <Button onClick={() => setConfirmOpen(true)}>Selesai & kumpulkan</Button>
            ) : (
              <Button onClick={() => setIndex((i) => Math.min(state.questions.length - 1, i + 1))}>Berikutnya →</Button>
            )}
          </div>
        </div>

        {/* Peta navigasi */}
        <aside className="glass h-fit p-4">
          <p className="mb-3 text-sm font-extrabold">Navigasi soal</p>
          <div className="grid grid-cols-5 gap-2">
            {state.questions.map((item, i) => {
              const answered = isAnswered(item.type, answers[item.id]);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setIndex(i)}
                  className={cn(
                    'relative flex h-9 items-center justify-center rounded-lg text-xs font-bold transition',
                    i === index
                      ? 'bg-brand-600 text-white'
                      : answered
                        ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                        : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400',
                  )}
                >
                  {i + 1}
                  {flagged[item.id] ? (
                    <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-white dark:ring-ink-950" />
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded bg-emerald-500/40" /> sudah dijawab
            </span>
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded bg-slate-300 dark:bg-white/20" /> belum dijawab
            </span>
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-amber-400" /> ragu-ragu
            </span>
          </div>
        </aside>
      </div>

      {confirmOpen ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div className="glass max-w-md p-6 text-center">
            <h2 className="text-lg font-extrabold">Kumpulkan jawaban?</h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {answeredCount} dari {state.questions.length} soal terjawab. Setelah dikumpulkan, jawaban tidak bisa diubah.
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={submitting}>
                Periksa lagi
              </Button>
              <Button variant="gold" onClick={() => void submit('MANUAL')} disabled={submitting}>
                {submitting ? 'Mengirim…' : 'Ya, kumpulkan'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
