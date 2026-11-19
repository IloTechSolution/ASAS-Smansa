import { Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useTheme } from '../theme/ThemeContext';
import { API_BASE } from '../lib/api';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'gold' | 'ghost' | 'danger';
}

export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60',
        variant === 'primary' &&
          'bg-gradient-to-r from-brand-600 to-brand-500 text-white shadow-glow hover:from-brand-500 hover:to-brand-400',
        variant === 'gold' &&
          'bg-gradient-to-r from-gold-600 to-gold-400 text-ink-950 shadow-glow-gold hover:brightness-105',
        variant === 'ghost' &&
          'border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-500',
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('glass p-6', className)}>{children}</div>;
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function TextInput({ label, error, id, className, ...props }: InputProps) {
  const inputId = id ?? `in-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      <input id={inputId} className="input-base" {...props} />
      {error ? <p className="mt-1 text-xs font-medium text-red-500">{error}</p> : null}
    </div>
  );
}

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-brand-500/30 bg-brand-500/10 px-2.5 py-0.5 text-xs font-semibold text-brand-600 dark:text-brand-300',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Tanda gabungan dua sekolah (dipakai bila sekolah tidak punya logo). */
function CombinedMark({ size }: { size: number }) {
  return (
    <div
      aria-hidden
      className="flex select-none flex-col items-center justify-center rounded-full bg-gradient-to-br from-brand-600 via-brand-500 to-gold-400 ring-2 ring-gold-400/70 shadow-glow"
      style={{ width: size, height: size }}
    >
      <span
        className="font-extrabold leading-none text-white"
        style={{ fontSize: Math.max(10, Math.floor(size * 0.34)) }}
      >
        1&amp;8
      </span>
      <span
        className="font-bold uppercase leading-none text-gold-200"
        style={{ fontSize: Math.max(5, Math.floor(size * 0.11)), letterSpacing: '0.18em' }}
      >
        CBT
      </span>
    </div>
  );
}

/**
 * Logo sekolah login: gambar bila sekolah punya logo (publik, dari server),
 * selain itu tanda gabungan 1&8. `school` kosong = mode agregat/login generik.
 */
export function Logo({ size = 56, school }: { size?: number; school?: { slug: string; hasLogo?: boolean } | null }) {
  const [failed, setFailed] = useState(false);
  if (school?.hasLogo && !failed) {
    return (
      <img
        src={`${API_BASE}/settings/public/logo?school=${encodeURIComponent(school.slug)}`}
        alt={`Logo ${school.slug.toUpperCase()}`}
        width={size}
        height={size}
        className="rounded-full object-cover ring-2 ring-gold-400/70 shadow-glow"
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
      />
    );
  }
  return <CombinedMark size={size} />;
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      title={theme === 'dark' ? 'Ganti ke mode terang' : 'Ganti ke mode gelap'}
      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 text-slate-600 transition hover:bg-slate-100 dark:border-white/10 dark:text-gold-300 dark:hover:bg-white/5"
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center p-10">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
    </div>
  );
}
