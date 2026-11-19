import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Loader2, Send, Timer, TriangleAlert } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { Badge, Button, Card, cn } from '../../components/ui';
import { ApiError, apiFetch } from '../../lib/api';
import { connectMonitor, disconnectMonitor } from '../../lib/monitor';

interface BoardUser {
  id: string;
  name: string;
  username: string;
  nisn: string | null;
  kelas: { name: string } | null;
}
interface BoardRow {
  attempt: {
    id: string;
    status: string;
    expiresAt: string;
    submittedAt: string | null;
    violationCount: number;
    lockedAt?: string | null;
  };
  user: BoardUser;
  answeredCount: number;
  questionCount: number;
  remainingSec: number;
  online: boolean;
  lastSeenAt: string | null;
}
interface Board {
  sessionId: string;
  session: { title: string; status: string; durationMin: number; maxViolations: number };
  questionCount: number;
  serverTime: string;
  summary: Record<string, number>;
  data: BoardRow[];
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function MonitoringPanel() {
  const { sessionId = '' } = useParams();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [busyId, setBusyId] = useState('');
  const [confirmId, setConfirmId] = useState('');
  const [warnMsg, setWarnMsg] = useState<Record<string, string>>({});
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      setBoard(await apiFetch<Board>(`/sessions/${sessionId}/monitoring`));
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal memuat monitoring');
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
    // Online status kini didorong heartbeat siswa (monitor:activity tiap 25 dtk
    // per peserta, di-debounce oleh handler di bawah) — polling hanya pelapis.
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  // Realtime: join ruang sesi, dengar snapshot & sinyal aktivitas.
  useEffect(() => {
    if (!sessionId) return;
    const s = connectMonitor();
    // Throttle, bukan debounce: activity jawaban datang terus-menerus, jadi
    // debounce 500 ms membuat papan tidak pernah refresh. Batasi maks 1 load/3 dtk.
    const refetch = () => {
      if (refetchTimer.current) return;
      refetchTimer.current = setTimeout(() => {
        refetchTimer.current = null;
        void load();
      }, 3_000);
    };
    const onSnapshot = (payload: Board) => setBoard(payload);
    const onActivity = (payload: { attemptId?: string; kind?: string; at?: string }) => {
      // Heartbeat hanya menandai peserta online — tidak perlu muat ulang papan.
      if (payload?.kind === 'heartbeat' && payload.attemptId) {
        const at = payload.at ?? new Date().toISOString();
        setBoard((b) =>
          b
            ? {
                ...b,
                data: b.data.map((r) =>
                  r.attempt.id === payload.attemptId ? { ...r, online: true, lastSeenAt: at } : r,
                ),
              }
            : b,
        );
        return;
      }
      refetch();
    };
    const onJoined = (res: { ok: boolean; error?: string }) => {
      if (!res.ok) setError(res.error ?? 'Gagal bergabung ke ruang monitoring');
    };
    const onConnect = () => {
      s.emit('monitor:join', sessionId, onJoined);
    };
    const onConnectError = () => setError('Koneksi realtime terputus — data mungkin tidak live');

    s.on('connect', onConnect);
    if (s.connected) s.emit('monitor:join', sessionId, onJoined);
    s.on('monitor:snapshot', onSnapshot);
    s.on('monitor:activity', onActivity);
    s.on('connect_error', onConnectError);

    return () => {
      s.off('connect', onConnect);
      s.off('connect_error', onConnectError);
      s.off('monitor:snapshot', onSnapshot);
      s.off('monitor:activity', onActivity);
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      disconnectMonitor();
    };
  }, [sessionId, load]);

  const act = async (attemptId: string, action: 'warn' | 'extend' | 'force-submit', body?: object) => {
    setBusyId(attemptId);
    setFlash('');
    try {
      const label =
        action === 'warn'
          ? 'Peringatan terkirim'
          : action === 'extend'
            ? 'Waktu diperpanjang'
            : 'Ujian dikumpulkan paksa';
      await apiFetch(`/attempts/${attemptId}/${action}`, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      });
      setFlash(label);
      await load();
    } catch (e) {
      setFlash(e instanceof ApiError ? e.message : 'Aksi gagal');
    } finally {
      setBusyId('');
      setConfirmId('');
    }
  };

  const remedial = async (attemptId: string) => {
    if (!window.confirm('Reset attempt ini (remedial)? Jawaban + nilai akan dihapus — siswa harus mengerjakan ulang.')) return;
    setBusyId(attemptId);
    setFlash('');
    try {
      await apiFetch(`/attempts/${attemptId}/reset`, { method: 'POST', body: JSON.stringify({ reason: 'remedial' }) });
      setFlash('Attempt direset — siswa bisa mengerjakan ulang.');
      await load();
    } catch (e) {
      setFlash(e instanceof ApiError ? e.message : 'Gagal mereset attempt');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-brand-500/30">
        <div className="flex flex-wrap items-center gap-2">
          <Activity size={18} className="text-brand-500" />
          <h1 className="text-xl font-extrabold">Monitoring Realtime</h1>
          <Badge>{board?.session.status ?? '-'}</Badge>
        </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Status live peserta, heartbeat online, dan kendali per peserta (peringat / perpanjang / kumpulkan).
            <span className="mt-1 block text-xs text-slate-400">
              Online hanya tercatat saat siswa berada <b>di dalam ruang ujian</b> — login saja belum menandakan online.
            </span>
          </p>
          {board ? (
            <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-7">
              {[
                ['Total', board.summary.total],
                ['Berjalan', board.summary.inProgress],
                ['Selesai', board.summary.submitted],
                ['Waktu habis', board.summary.expired],
                ['Paksa', board.summary.forced],
                ['Terkunci', board.summary.locked],
                ['Online', board.summary.online],
              ].map(([k, v]) => (
              <div key={String(k)} className="rounded-xl bg-slate-100 py-2 dark:bg-white/5">
                <div className="text-lg font-extrabold">{String(v ?? 0)}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{String(k)}</div>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      {error ? <Card className="border-amber-500/30 text-sm text-amber-600">{error}</Card> : null}
      {flash ? <Card className="border-brand-500/30 text-sm font-semibold text-brand-600 dark:text-brand-300">{flash}</Card> : null}

      {!board && !error ? (
        <Card>
          <Loader2 className="animate-spin" />
        </Card>
      ) : null}

      {board && board.data.length === 0 ? (
        <Card className="text-sm text-slate-500 dark:text-slate-400">
          Belum ada peserta yang mengerjakan. Sesi {board.session.status === 'ACTIVE' ? 'sudah aktif' : 'belum aktif'}.
        </Card>
      ) : null}

      {board?.data.map((row) => (
        <Card key={row.attempt.id} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0">
              <p className="truncate font-extrabold">{row.user.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {row.user.kelas?.name ?? '-'} · {row.user.username}
              </p>
            </div>
            <span
              className={cn(
                'h-2.5 w-2.5 shrink-0 rounded-full',
                row.online ? 'bg-emerald-500' : row.attempt.status === 'IN_PROGRESS' ? 'bg-amber-400' : 'bg-slate-400',
              )}
              title={row.lastSeenAt ? `Terakhir online ${new Date(row.lastSeenAt).toLocaleTimeString('id-ID')}` : 'Belum pernah online'}
            />
            {row.attempt.lockedAt ? (
              <Badge className="border-red-500/50 bg-red-500/10 font-bold text-red-500">TERKUNCI</Badge>
            ) : null}
            <Badge
              className={cn(
                row.attempt.status === 'IN_PROGRESS' && 'border-brand-500/40 text-brand-600 dark:text-brand-300',
                row.attempt.status === 'SUBMITTED' && 'border-emerald-500/40 text-emerald-600 dark:text-emerald-300',
                (row.attempt.status === 'EXPIRED' || row.attempt.status === 'FORCE_SUBMITTED') && 'border-red-500/40 text-red-500',
              )}
            >
              {row.attempt.status}
            </Badge>
            <span className="ml-auto flex items-center gap-4 text-sm">
              <span className="text-slate-500 dark:text-slate-400">
                {row.answeredCount}/{row.questionCount} soal
              </span>
              <span className={cn('flex items-center gap-1 font-mono font-bold', row.remainingSec < 300 ? 'text-red-500' : 'text-slate-700 dark:text-slate-200')}>
                <Timer size={14} /> {fmt(row.remainingSec)}
              </span>
              <span className={cn('flex items-center gap-1 font-bold', row.attempt.violationCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400')}>
                <TriangleAlert size={14} /> {row.attempt.violationCount}
              </span>
            </span>
          </div>

          {row.attempt.status === 'IN_PROGRESS' ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-white/10">
              <input
                className="input-base max-w-[16rem] !py-1.5 text-sm"
                placeholder="Pesan peringatan…"
                value={warnMsg[row.attempt.id] ?? ''}
                onChange={(e) => setWarnMsg((p) => ({ ...p, [row.attempt.id]: e.target.value }))}
                maxLength={200}
              />
              <Button
                variant="ghost"
                disabled={busyId === row.attempt.id || !(warnMsg[row.attempt.id] ?? '').trim()}
                onClick={() => void act(row.attempt.id, 'warn', { message: (warnMsg[row.attempt.id] ?? '').trim() })}
              >
                <Send size={14} /> Peringatkan
              </Button>
              <Button variant="ghost" disabled={busyId === row.attempt.id} onClick={() => void act(row.attempt.id, 'extend', { minutes: 5, note: '+5 menit' })}>
                +5 menit
              </Button>
              <Button variant="ghost" disabled={busyId === row.attempt.id} onClick={() => void act(row.attempt.id, 'extend', { minutes: 15, note: '+15 menit' })}>
                +15 menit
              </Button>
              {confirmId === row.attempt.id ? (
                <Button variant="danger" disabled={busyId === row.attempt.id} onClick={() => void act(row.attempt.id, 'force-submit')}>
                  Konfirmasi kumpulkan
                </Button>
              ) : (
                <Button variant="danger" onClick={() => setConfirmId(row.attempt.id)}>
                  Kumpulkan paksa
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-white/10">
              <Button variant="ghost" disabled={busyId === row.attempt.id} onClick={() => void remedial(row.attempt.id)}>
                Reset remedial
              </Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
