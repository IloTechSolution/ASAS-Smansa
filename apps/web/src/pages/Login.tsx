import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { z } from 'zod';
import { ChevronRight, Eye, EyeOff, Loader2, Lock, UserRound } from 'lucide-react';
import { loginSchema } from '@cbt/shared';
import { useAuth } from '../auth/AuthContext';
import { API_BASE, ApiError } from '../lib/api';
import { Logo, ThemeToggle, cn } from '../components/ui';
import { useBrand } from '../lib/brand';
import { unlockAudio } from '../lib/alarm';
import { sebMaximizeVolume } from '../lib/seb';

const HOME_BY_ROLE = { ADMIN: '/app/admin', GURU: '/app/guru', SISWA: '/app/siswa', PROKTOR: '/app/proktor' } as const;

const NOISE =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")";

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, login } = useAuth();
  const brand = useBrand();
  const notice = (location.state as { notice?: string } | null)?.notice;

  // Logo sekolah default diambil dari server (bukan hardcode slug tertentu).
  const [logoSchool, setLogoSchool] = useState<{ slug: string; hasLogo: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    fetch(`${API_BASE}/settings/public`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { HAS_LOGO?: string; SCHOOL_SLUG?: string } | null) => {
        if (active && d?.HAS_LOGO === 'true' && typeof d.SCHOOL_SLUG === 'string') {
          setLogoSchool({ slug: d.SCHOOL_SLUG, hasLogo: true });
        }
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldError, setFieldError] = useState('');
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) {
    return <Navigate to={HOME_BY_ROLE[user.role]} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFieldError('');
    setServerError('');
    try {
      loginSchema.parse({ username, password });
    } catch (err) {
      if (err instanceof z.ZodError) {
        setFieldError(err.issues[0]?.message ?? 'Periksa kembali isian Anda');
        return;
      }
    }
    unlockAudio();
    sebMaximizeVolume();
    setBusy(true);
    try {
      const u = await login(username.trim(), password);
      navigate(HOME_BY_ROLE[u.role], { replace: true });
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Gagal masuk, coba lagi');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen overflow-hidden bg-[#050B16] font-sans text-slate-100">
      {/* Aurora + grid + noise */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-brand-600/25 blur-[130px]" />
        <div className="absolute -right-48 top-1/4 h-[36rem] w-[36rem] rounded-full bg-gold-400/[0.08] blur-[150px]" />
        <div className="absolute -bottom-48 left-1/4 h-[32rem] w-[32rem] rounded-full bg-indigo-700/20 blur-[160px]" />
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              'linear-gradient(rgba(148,197,255,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(148,197,255,0.055) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(ellipse 85% 75% at 50% 40%, black 25%, transparent 75%)',
            WebkitMaskImage: 'radial-gradient(ellipse 85% 75% at 50% 40%, black 25%, transparent 75%)',
          }}
        />
        <div className="absolute inset-0 opacity-[0.05] mix-blend-overlay" style={{ backgroundImage: NOISE }} />
        {/* Cincin orbit dekoratif di sisi kanan */}
        <div className="absolute -right-48 top-1/2 hidden h-[44rem] w-[44rem] -translate-y-1/2 rounded-full border border-white/[0.05] lg:block" />
        <div className="absolute -right-24 top-1/2 hidden h-[28rem] w-[28rem] -translate-y-1/2 rounded-full border border-white/[0.07] lg:block" />
        <div className="absolute right-4 top-1/2 hidden h-[12rem] w-[12rem] -translate-y-1/2 rounded-full border border-gold-400/[0.12] lg:block" />
      </div>

      <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>

      <div className="relative grid w-full lg:grid-cols-2">
        {/* Kolom kiri — pernyataan */}
        <div className="flex flex-col justify-between gap-10 px-6 py-8 sm:px-12 sm:py-10 lg:px-16 xl:px-20 lg:py-14">
          <div className="rise flex items-center gap-3">
            <Logo size={46} school={logoSchool} />
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.32em] text-gold-300/90">{brand.SCHOOL_NAME}</p>
              <p className="mt-0.5 text-[11px] font-semibold tracking-wide text-slate-500">COMPUTER BASED TEST</p>
            </div>
          </div>

          <h1 className="rise select-none" style={{ animationDelay: '140ms' }}>
            <span className="block text-5xl font-extrabold uppercase leading-[0.98] tracking-[-0.02em] text-slate-100 sm:text-6xl xl:text-7xl">
              Ujian yang<br />jujur,
            </span>
            <span className="mt-5 block text-4xl font-bold uppercase leading-[1.02] tracking-[-0.01em] text-slate-500 sm:text-5xl xl:text-6xl">
              dikerjakan<br />dengan
            </span>
            <span
              className="mt-3 block bg-clip-text font-serif text-7xl font-light normal-case italic leading-none text-transparent sm:text-8xl xl:text-[7.5rem]"
              style={{ backgroundImage: 'linear-gradient(100deg, #FFE28A 0%, #FFC53D 35%, #C9BCFF 100%)' }}
            >
              tenang.
            </span>
          </h1>

          <div className="rise flex items-center gap-4 text-[10px] font-extrabold uppercase tracking-[0.3em] text-slate-600" style={{ animationDelay: '280ms' }}>
            <span aria-hidden className="h-px w-12 bg-gradient-to-r from-transparent via-gold-400/70 to-transparent" />
            Tahun Ajaran {brand.TAHUN_AJARAN}
          </div>
        </div>

        {/* Kolom kanan — kartu login */}
        <div className="flex items-center justify-center px-4 pb-10 pt-2 sm:px-8 sm:pb-14 lg:px-16 lg:py-10 xl:px-24">
          <form
            onSubmit={onSubmit}
            className="rise relative w-full max-w-md rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.03] p-6 shadow-[0_40px_80px_-24px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.09)] backdrop-blur-2xl sm:p-8"
            style={{ animationDelay: '220ms' }}
          >
            <div aria-hidden className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold-300/80 to-transparent" />
            {notice ? (
              <div role="alert" className="mb-4 flex items-start gap-2.5 rounded-2xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm font-semibold leading-snug text-red-300">
                <span aria-hidden className="mt-0.5">!</span>
                <span>{notice}</span>
              </div>
            ) : null}

            <p className="text-[10px] font-extrabold uppercase tracking-[0.35em] text-gold-300/90">Masuk</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Gunakan NISN (siswa) atau username (guru/staf) dan password Anda.
            </p>

            <div className="mt-6 flex flex-col gap-4">
              {/* Username / NISN */}
              <div className="group">
                <label htmlFor="login-username" className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 transition group-focus-within:text-gold-300/90">
                  Nama pengguna / NISN
                </label>
                <div className="flex h-12 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 transition focus-within:border-gold-400/50 focus-within:bg-white/[0.06] focus-within:ring-2 focus-within:ring-gold-400/20">
                  <UserRound size={17} className="shrink-0 text-slate-500 transition group-focus-within:text-gold-300/90" />
                  <input
                    id="login-username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="NISN untuk siswa · username untuk guru/staf"
                    autoComplete="username"
                    autoFocus
                    className="h-full w-full bg-transparent text-[15px] font-medium text-slate-100 outline-none placeholder:text-slate-600"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="group">
                <label htmlFor="login-password" className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 transition group-focus-within:text-gold-300/90">
                  Password
                </label>
                <div className="flex h-12 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 transition focus-within:border-gold-400/50 focus-within:bg-white/[0.06] focus-within:ring-2 focus-within:ring-gold-400/20">
                  <Lock size={17} className="shrink-0 text-slate-500 transition group-focus-within:text-gold-300/90" />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="h-full w-full bg-transparent text-[15px] font-medium tracking-wide text-slate-100 outline-none placeholder:text-slate-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-pressed={showPassword}
                    aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                    title={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                    className="shrink-0 text-slate-500 transition hover:text-slate-200"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            </div>

            {fieldError ? <p className="mt-3 text-sm font-medium text-red-400">{fieldError}</p> : null}
            {serverError ? (
              <p className="mt-3 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300" role="alert">
                {serverError}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className={cn(
                'group mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-gold-300 via-gold-400 to-gold-500',
                'text-[15px] font-extrabold uppercase tracking-[0.18em] text-ink-900 transition',
                'shadow-[0_16px_40px_-12px_rgba(255,197,61,0.45)] hover:shadow-[0_20px_50px_-12px_rgba(255,197,61,0.6)] hover:brightness-110 active:scale-[0.99]',
                'disabled:cursor-not-allowed disabled:opacity-60',
              )}
            >
              {busy ? (
                <>
                  <Loader2 size={18} className="animate-spin" /> Memeriksa…
                </>
              ) : (
                <>
                  Masuk
                  <ChevronRight size={18} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
