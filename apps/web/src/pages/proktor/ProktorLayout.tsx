import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import { Badge, Button, cn } from '../../components/ui';
import { ApiError, apiFetch } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';

type DayName = 'SENIN' | 'SELASA' | 'RABU' | 'KAMIS' | 'JUMAT';

interface SessionInfo {
  id: string;
  title: string | null;
  status: string;
  hariPelaksanaan: DayName | null;
  visibleToSiswa: boolean;
  exam: { id: string; title: string };
}

const DAY_LABEL: Record<DayName, string> = {
  SENIN: 'Hari 1 · Senin',
  SELASA: 'Hari 2 · Selasa',
  RABU: 'Hari 3 · Rabu',
  KAMIS: 'Hari 4 · Kamis',
  JUMAT: 'Hari 5 · Jumat',
};

/** Token hanya untuk PROKTOR & ADMIN; sisanya terbuka utk guru pemegang sesi. */
const TABS = [
  { to: 'token', label: 'Token', roles: ['PROKTOR', 'ADMIN'] as string[] },
  { to: 'absensi', label: 'Absensi', roles: ['PROKTOR', 'ADMIN', 'GURU'] },
  { to: 'pengaturan', label: 'Pengaturan', roles: ['PROKTOR', 'ADMIN', 'GURU'] },
  { to: 'integritas', label: 'Integritas', roles: ['PROKTOR', 'ADMIN', 'GURU'] },
  { to: 'monitoring', label: 'Monitoring Live', roles: ['PROKTOR', 'ADMIN', 'GURU'] },
];

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-xl px-3 py-2 text-sm font-semibold transition',
    isActive
      ? 'bg-brand-500/15 text-brand-700 dark:text-brand-200'
      : 'border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5',
  );

export default function ProktorLayout() {
  const { sessionId = '' } = useParams();
  const base = `/app/proktor/sesi/${sessionId}`;
  const { user } = useAuth();
  const canToggle = user?.role === 'PROKTOR' || user?.role === 'ADMIN' || user?.role === 'GURU';
  const canRelease = user?.role === 'PROKTOR' || user?.role === 'ADMIN';
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releasedToken, setReleasedToken] = useState('');
  const tabs = TABS.filter((t) => !user || t.roles.includes(user.role));

  const load = useCallback(() => {
    if (!sessionId) return;
    setError('');
    apiFetch<SessionInfo>(`/sessions/${sessionId}`)
      .then(setSession)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Gagal memuat sesi'));
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleVisibility = () => {
    if (!session || busy) return;
    const next = !session.visibleToSiswa;
    if (next) {
      const ok = window.confirm(
        `Tampilkan ujian "${session.title ?? session.exam.title}" ke siswa?\n\nSiswa akan langsung melihat ujian ini di "Ujian Saya" dan bisa mulai (setelah token dirilis). Pastikan jumlah kelas & soal sudah benar.`,
      );
      if (!ok) return;
    }
    setBusy(true);
    setError('');
    apiFetch<{ ok: boolean; visibleToSiswa: boolean }>(`/sessions/${sessionId}/visibility`, {
      method: 'PATCH',
      body: JSON.stringify({ visible: next }),
    })
      .then(() => {
        if (next) setReleaseOpen(true);
        load();
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Gagal mengubah visibilitas'))
      .finally(() => setBusy(false));
  };

  const releaseNow = () => {
    setReleaseBusy(true);
    setError('');
    apiFetch<{ token?: string }>(`/sessions/${sessionId}/token/release`, {
      method: 'POST',
      body: JSON.stringify({ note: 'Rilis dari dialog tampilkan ke siswa' }),
    })
      .then((d) => {
        setReleasedToken(d.token ?? '');
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Gagal merilis token'))
      .finally(() => setReleaseBusy(false));
  };

  const visible = session?.visibleToSiswa ?? false;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          to="/app/proktor/sesi"
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300"
        >
          <ArrowLeft size={14} /> Semua sesi
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-extrabold">
            {session ? session.title ?? session.exam.title : 'Panel Pelaksanaan'}
            {session?.hariPelaksanaan ? <Badge className="border-gold-400/40 text-gold-600 dark:text-gold-300">{DAY_LABEL[session.hariPelaksanaan]}</Badge> : null}
            {session ? (
              visible ? (
                <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">Tampil ke siswa</Badge>
              ) : (
                <Badge>Tersembunyi dari siswa</Badge>
              )
            ) : null}
          </h1>
          {canToggle && session ? (
            <button
              type="button"
              onClick={toggleVisibility}
              disabled={busy}
              aria-pressed={visible}
              className={cn(
                'ml-auto inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-bold shadow-sm transition disabled:opacity-60',
                visible
                  ? 'border-red-500/50 bg-red-500/10 text-red-500 hover:bg-red-500/20'
                  : 'border-emerald-500/60 bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 dark:text-emerald-300',
              )}
            >
              {busy ? (
                <Loader2 size={16} className="animate-spin" />
              ) : visible ? (
                <EyeOff size={16} />
              ) : (
                <Eye size={16} />
              )}
              {visible ? 'Sembunyikan dari Siswa' : 'Tampilkan ke Siswa'}
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {session ? `Ujian: ${session.exam.title}` : 'Memuat detail sesi…'}
        </p>
        {error ? <p className="mt-2 text-sm font-semibold text-red-500">{error}</p> : null}
      </div>

      <nav className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <NavLink key={t.to} to={`${base}/${t.to}`} className={navClass}>
            {t.label}
          </NavLink>
        ))}
        {user?.role === 'GURU' ? (
          <span className="self-center text-xs font-medium text-slate-400 dark:text-slate-500">
            Token dirilis proktor/admin
          </span>
        ) : null}
      </nav>

      <Outlet />

      {/* Dialog setelah "Tampilkan ke Siswa" diklik: rilis token? */}
      {releaseOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={() => setReleaseOpen(false)}>
          <div
            className="glass w-full max-w-md p-6 text-center"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <KeyRound className="mx-auto text-gold-500" size={40} />
            <h3 className="mt-3 text-lg font-extrabold">Ujian tampil ke siswa</h3>
            {releasedToken ? (
              <>
                <p className="mt-2 text-sm text-slate-400">Token sudah dirilis & tercatat di audit:</p>
                <p className="mt-2 font-mono text-4xl font-bold tracking-[0.3em] text-brand-700 dark:text-brand-200">{releasedToken}</p>
                <p className="mt-2 text-xs text-slate-500">Beri token ini ke siswa. Interval token diatur di tab Token.</p>
                <Button type="button" variant="gold" className="mt-4 w-full" onClick={() => setReleaseOpen(false)}>
                  Tutup
                </Button>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  Ujian sudah tampil di "Ujian Saya". Token <b>belum</b> dirilis — siswa belum bisa mulai sampai token dirilis. Rilis sekarang?
                </p>
                {error ? <p className="mt-2 text-sm font-semibold text-red-500">{error}</p> : null}
                <div className="mt-4 flex flex-col gap-2">
                  {canRelease ? (
                    <Button type="button" variant="gold" onClick={releaseNow} disabled={releaseBusy}>
                      {releaseBusy ? 'Merilis…' : 'Rilis token sekarang'}
                    </Button>
                  ) : (
                    <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-600 dark:text-amber-300">
                      Token dirilis oleh proktor/admin — beri tahu proktor untuk merilis token.
                    </p>
                  )}
                  <Button type="button" variant="ghost" onClick={() => setReleaseOpen(false)}>
                    Nanti saja (ke tab Token)
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
