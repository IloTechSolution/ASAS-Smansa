import {
  BookOpenCheck,
  CalendarClock,
  ClipboardList,
  ClipboardCheck,
  IdCard,
  Gauge,
  History,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MonitorPlay,
  Radio,
  Settings,
  ShieldAlert,
  SquarePen,
  Users,
  UserPlus,
  School,
} from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import type { Role } from '@cbt/shared';
import { ROLE_ACCENT, ROLE_LABEL } from '@cbt/shared';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../lib/api';
import { Logo, ThemeToggle, cn } from './ui';
import { useBrand } from '../lib/brand';

interface SchoolOption {
  id: string;
  slug: string;
  name: string;
  appName: string;
  hasLogo?: boolean;
}

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  soon?: boolean;
  /** Judul grup — bila diisi, dirender sebagai header kecil di atas item. */
  section?: string;
}

const NAV: Record<Role, NavItem[]> = {
  ADMIN: [
    { to: '/app/admin', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/app/admin/pengguna', label: 'Pengguna', icon: Users, section: 'Data Master' },
    { to: '/app/admin/siswa', label: 'Siswa', icon: Users },
    { to: '/app/admin/kelas', label: 'Kelas', icon: School },
    { to: '/app/admin/mapel', label: 'Mapel', icon: BookOpenCheck },
    { to: '/app/guru/soal', label: 'Bank Soal', icon: BookOpenCheck, section: 'Akademik' },
    { to: '/app/guru/ujian', label: 'Ujian', icon: SquarePen },
    { to: '/app/guru/sesi', label: 'Sesi', icon: CalendarClock },
    { to: '/app/guru/nilai', label: 'Nilai', icon: ClipboardList },
    { to: '/app/proktor/sesi', label: 'Pelaksanaan', icon: MonitorPlay, section: 'Pelaksanaan' },
    { to: '/app/kartu', label: 'Kartu Login', icon: IdCard },
    { to: '/app/enrol-siswa', label: 'Enrol Siswa', icon: UserPlus },
    { to: '/app/pelanggaran', label: 'Monitoring Pelanggaran', icon: ShieldAlert },
    { to: '/app/kehadiran', label: 'Siswa Online', icon: Radio },
    { to: '/app/admin/pengaturan', label: 'Konfigurasi', icon: Settings, section: 'Sistem' },
    { to: '/app/admin/audit', label: 'Audit Log', icon: History },
    { to: '/app/akun', label: 'Akun', icon: KeyRound },
  ],
  GURU: [
    { to: '/app/guru', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/app/guru/soal', label: 'Bank Soal', icon: BookOpenCheck },
    { to: '/app/guru/ujian', label: 'Ujian', icon: SquarePen },
    { to: '/app/guru/sesi', label: 'Sesi', icon: CalendarClock },
    { to: '/app/guru/nilai', label: 'Nilai', icon: ClipboardList },
    { to: '/app/guru/mapel', label: 'KKM Mapel', icon: Gauge },
    { to: '/app/akun', label: 'Akun', icon: KeyRound },
  ],
  SISWA: [
    { to: '/app/siswa', label: 'Ujian Saya', icon: SquarePen },
    { to: '/app/akun', label: 'Akun', icon: KeyRound },
  ],
  PROKTOR: [
    { to: '/app/proktor', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/app/proktor/sesi', label: 'Sesi & Token', icon: ClipboardCheck },
    { to: '/app/kartu', label: 'Kartu Login', icon: IdCard },
    { to: '/app/enrol-siswa', label: 'Enrol Siswa', icon: UserPlus },
    { to: '/app/pelanggaran', label: 'Monitoring Pelanggaran', icon: ShieldAlert },
    { to: '/app/kehadiran', label: 'Siswa Online', icon: Radio },
    { to: '/app/akun', label: 'Akun', icon: KeyRound },
  ],
};

export function AppShell() {
  const { user, logout } = useAuth();
  const brand = useBrand();
  const navigate = useNavigate();
  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [schoolSel, setSchoolSel] = useState<string>(() => (localStorage.getItem('cbt_school_id') ?? '').trim());
  const isAdmin = user?.role === 'ADMIN';
  const aggregate = isAdmin && !schoolSel;

  // Admin boleh mengganti konteks sekolah kapan pun; perubahan berlaku penuh
  // setelah reload (brand, data, header API ikut switcher).
  useEffect(() => {
    if (!isAdmin) return;
    apiFetch<SchoolOption[]>('/settings/schools')
      .then((rows) => setSchools(Array.isArray(rows) ? rows : []))
      .catch(() => setSchools([]));
  }, [isAdmin]);

  // Brand kontekstual: admin melihat sekolah yang DIPILIH di switcher
  // (bukan sekolah akunnya); non-admin mengikuti sekolah akun.
  const selSchool = isAdmin ? (schools.find((s) => s.slug === schoolSel) ?? null) : null;
  const appNameNow = isAdmin
    ? (selSchool?.appName ?? 'CBT SMAN 1 & 8 GORONTALO')
    : (user?.school?.appName ?? 'CBT SMAN 1 & 8 GORONTALO');
  useEffect(() => {
    document.title = appNameNow;
  }, [appNameNow]);

  // Presence siswa: beri tahu server tiap 45 detik bahwa akun ini aktif
  // (dipakai halaman "Siswa Online"). Ruang ujian juga menandai lewat heartbeat.
  useEffect(() => {
    if (user?.role !== 'SISWA') return undefined;
    let alive = true;
    const ping = () => {
      if (!alive) return;
      apiFetch('/presence/ping', { method: 'POST', body: '{}' }).catch(() => undefined);
    };
    ping();
    const id = setInterval(ping, 45_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [user?.role]);

  if (!user) return null;

  const accent = ROLE_ACCENT[user.role];
  const items = NAV[user.role];

  const changeSchool = (v: string) => {
    setSchoolSel(v);
    if (v) localStorage.setItem('cbt_school_id', v);
    else localStorage.removeItem('cbt_school_id');
    window.location.reload();
  };

  const brandNow = isAdmin
    ? selSchool
      ? { ...brand, SCHOOL_NAME: selSchool.name, APP_NAME: selSchool.appName }
      : { SCHOOL_NAME: 'SMAN 1 & 8 Gorontalo', APP_NAME: 'CBT SMAN 1 & 8 GORONTALO', TAHUN_AJARAN: brand.TAHUN_AJARAN }
    : brand;
  const logoSchool: { slug: string; hasLogo?: boolean } | null = isAdmin
    ? (selSchool ? { slug: selSchool.slug, hasLogo: selSchool.hasLogo } : null)
    : (user.school ?? null);

  const handleLogout = () => {
    logout();
    navigate('/', { replace: true });
  };

  return (
    <div className="bg-scene flex min-h-screen">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white/70 p-5 backdrop-blur-xl md:flex print:hidden dark:border-white/10 dark:bg-ink-950/60">
        <div className="flex items-center gap-3">
          <Logo size={44} school={logoSchool} />
          <div className="min-w-0">
            <p className="text-sm font-extrabold leading-tight">{brandNow.APP_NAME}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400" style={{ color: accent }}>
              {ROLE_LABEL[user.role]}
            </p>
          </div>
        </div>
        <nav className="mt-8 flex flex-col gap-1 overflow-y-auto">
          {items.map((item, i) => (
            <div key={item.to} className="flex flex-col gap-1">
              {item.section && (i === 0 || items[i - 1].section !== item.section) ? (
                <p className="mt-3 px-3 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 first:mt-0 dark:text-slate-500">
                  {item.section}
                </p>
              ) : null}
            <NavLink
              to={item.to}
              end={item.to.split('/').length === 3}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition',
                  isActive
                    ? 'bg-brand-500/15 text-brand-700 dark:text-brand-200'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5',
                  item.soon && 'pointer-events-none opacity-60',
                )
              }
            >
              <item.icon size={18} />
              {item.label}
              {item.soon ? (
                <span className="ml-auto rounded-full bg-gold-400/20 px-2 py-0.5 text-[10px] font-bold text-gold-600 dark:text-gold-300">
                  SEGERA
                </span>
              ) : null}
            </NavLink>
            </div>
          ))}
        </nav>
        <div className="mt-auto">
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-red-500 transition hover:bg-red-500/10"
          >
            <LogOut size={18} /> Keluar
          </button>
        </div>
      </aside>

      {/* Konten */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/70 backdrop-blur-xl print:hidden dark:border-white/10 dark:bg-ink-950/60">
          {isAdmin && aggregate ? (
            <div className="border-b border-amber-400/40 bg-amber-400/15 px-4 py-1.5 text-center text-[11px] font-semibold text-amber-700 md:px-8 dark:text-amber-300">
              Mode Semua Sekolah — tampilan gabungan. Pilih sekolah di kanan atas untuk menambah/mengubah data.
            </div>
          ) : null}
          <div className="flex items-center gap-3 px-4 py-3 md:px-8">
            <div className="flex items-center gap-2 md:hidden">
              <Logo size={32} school={logoSchool} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold">{user.name}</p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {user.username} · {ROLE_LABEL[user.role]}
                {user.kelas ? ` · ${user.kelas.name}` : ''}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {isAdmin ? (
                <select
                  value={schoolSel}
                  onChange={(e) => changeSchool(e.target.value)}
                  title="Konteks sekolah admin"
                  className="h-10 rounded-xl border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700 transition focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-ink-900 dark:text-slate-100"
                >
                  <option value="">Semua Sekolah</option>
                  {schools.map((s) => (
                    <option key={s.id} value={s.slug}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <ThemeToggle />
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 text-red-500 transition hover:bg-red-500/10 md:hidden dark:border-white/10"
                title="Keluar"
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
