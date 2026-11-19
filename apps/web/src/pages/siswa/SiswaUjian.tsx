import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, KeyRound, Loader2, MapPin, PlayCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Button, Card, TextInput } from '../../components/ui';
import { ApiError, apiFetch } from '../../lib/api';
import { isSebClient, sebMaximizeVolume } from '../../lib/seb';
import { unlockAudio } from '../../lib/alarm';

interface Available {
  id: string;
  title: string;
  exam: { id: string; title: string; mapel: { name: string } | null };
  status?: string;
  startsAt: string | null;
  endsAt: string | null;
  durationMin: number;
  requireSeb: boolean;
  expired: boolean;
  /** Guru sudah menerbitkan hasil sesi ini — nilai TIDAK ditampilkan di aplikasi (11 Nov 2026). */
  resultsPublished: boolean;
  attempt: {
    id: string;
    status: string;
    /** Nilai tidak pernah diisi untuk tampilan siswa. */
    score: null;
    submittedAt: string | null;
    expiresAt: string;
    isActive: boolean;
    /** Terkunci (batas pelanggaran) — minta token proktor untuk membuka kembali. */
    lockedAt?: string | null;
  } | null;
}

function fmtDate(v: string | null): string {
  if (!v) return '-';
  return new Date(v).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

export function SiswaUjian() {
  const navigate = useNavigate();
  const { user: me } = useAuth();
  const [data, setData] = useState<Available[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [active, setActive] = useState<Available | null>(null);
  const [token, setToken] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: Available[] }>('/attempts/available');
      setData(res.data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal memuat daftar ujian');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const start = async () => {
    if (!active) return;
    unlockAudio();
    sebMaximizeVolume();
    setStarting(true);
    setStartError('');
    try {
      const isSeb = isSebClient();
      const res = await apiFetch<{ attempt: { id: string } }>('/attempts/start', {
        method: 'POST',
        body: JSON.stringify({ sessionId: active.id, token, seb: isSeb }),
      });
      // Fullscreen opsional & tidak boleh memblokir navigasi (beberapa browser menggantung promise-nya).
      try {
        const p = document.documentElement.requestFullscreen?.();
        if (p) void p.catch(() => undefined);
      } catch {
        // diabaikan bila ditolak browser
      }
      navigate(`/ujian/${res.attempt.id}`);
    } catch (e) {
      setStartError(e instanceof ApiError ? e.message : 'Gagal memulai ujian');
    } finally {
      setStarting(false);
    }
  };

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
        <h1 className="text-xl font-extrabold">Ujian Saya</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Pilih ujian yang aktif, minta token 6 digit ke proktor, lalu kerjakan. Jangan keluar layar atau pindah tab.
        </p>
      </Card>

      <Card className="border-gold-400/40 bg-gold-400/5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Ruang ujian Anda
            </p>
            <p className="mt-0.5 flex items-center gap-2 text-lg font-extrabold text-brand-800 dark:text-brand-200">
              <MapPin size={18} /> {me?.ruang ?? 'Belum ditentukan'}
            </p>
          </div>
          {!me?.ruang ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">Hubungi admin sekolah bila ruang belum diisi.</p>
          ) : null}
        </div>
      </Card>

      {error ? <Card className="border-red-500/30 text-sm text-red-500">{error}</Card> : null}

      {data.length === 0 ? (
        <Card className="text-sm text-slate-500 dark:text-slate-400">
          Belum ada ujian untuk kelas Anda. Tunggu proktor memulai sesi.
        </Card>
      ) : null}

      {data.map((s) => {
        const continuing = s.attempt?.isActive;
        const locked = Boolean(s.attempt?.lockedAt);
        return (
          <Card key={s.id} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-extrabold">{s.title}</h2>
              {s.requireSeb ? <Badge className="border-gold-400/40 text-gold-600 dark:text-gold-300">SEB</Badge> : null}
              {locked ? (
                <Badge className="border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300">TERKUNCI</Badge>
              ) : null}
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {s.exam.title}
              {s.exam.mapel ? ` · ${s.exam.mapel.name}` : ''} · {s.durationMin} menit
            </p>
            <p className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <CalendarClock size={14} /> {fmtDate(s.startsAt)} — {fmtDate(s.endsAt)}
            </p>
            <div className="flex items-center gap-3">
              {continuing ? (
                <Button variant={locked ? 'danger' : 'primary'} onClick={() => navigate(`/ujian/${s.attempt?.id}`)}>
                  <PlayCircle size={16} /> {locked ? 'Terkunci — minta token proktor' : 'Lanjutkan ujian'}
                </Button>
              ) : s.attempt ? (
                <>
                  <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Sudah dikerjakan</span>
                  {s.resultsPublished ? (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Nilai sudah diumumkan guru — tanyakan nilai Anda di kelas / sekolah.
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500 dark:text-slate-400">Menunggu pengumuman guru.</span>
                  )}
                </>
              ) : s.status === 'ACTIVE' && !s.expired ? (
                <Button onClick={() => { setActive(s); setToken(''); setStartError(''); }}>
                  <KeyRound size={16} /> Mulai (butuh token)
                </Button>
              ) : (
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  {s.status === 'SCHEDULED' ? 'Menunggu proktor mengaktifkan sesi.' : 'Sesi tidak tersedia.'}
                </span>
              )}
            </div>
          </Card>
        );
      })}

      {active ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md">
            <Card>
              <h2 className="text-lg font-extrabold">Masukkan token ujian</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {active.title} — minta 6 digit token terbaru ke proktor.
              </p>
              {active.requireSeb ? (
                <p className="mt-2 rounded-lg bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  Ujian ini wajib dibuka dengan Safe Exam Browser (SEB).
                </p>
              ) : null}
              <div className="mt-4">
                <TextInput
                  label="Token 6 digit"
                  value={token}
                  onChange={(e) => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  inputMode="numeric"
                  className="[&_input]:text-center [&_input]:text-2xl [&_input]:font-mono [&_input]:tracking-[0.4em]"
                />
              </div>
              {startError ? <p className="mt-2 text-sm font-medium text-red-500">{startError}</p> : null}
              <div className="mt-5 flex justify-end gap-3">
                <Button variant="ghost" onClick={() => setActive(null)} disabled={starting}>
                  Batal
                </Button>
                <Button onClick={() => void start()} disabled={starting || token.length !== 6}>
                  {starting ? 'Memulai…' : 'Mulai ujian'}
                </Button>
              </div>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}
