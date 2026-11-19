import { useEffect } from 'react';
import type { ReactNode, SelectHTMLAttributes } from 'react';
import { Button, cn } from './ui';

/** Banner error API. */
export function ErrorBanner({ message, onClose }: { message: string; onClose?: () => void }) {
  if (!message) return null;
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-500">
      <span>{message}</span>
      {onClose ? (
        <button type="button" onClick={onClose} className="font-bold hover:opacity-70" title="Tutup">
          ×
        </button>
      ) : null}
    </div>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
}

/** Dropdown berlabel selaras TextInput. */
export function Select({ label, id, className, children, ...props }: SelectProps) {
  const inputId = id ?? `sel-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      <select id={inputId} className="input-base" {...props}>
        {children}
      </select>
    </div>
  );
}

/** Modal sederhana. */
export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn('glass max-h-[90vh] w-full overflow-y-auto p-6', wide ? 'max-w-2xl' : 'max-w-md')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-extrabold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-lg text-slate-500 transition hover:bg-slate-200/60 dark:text-slate-400 dark:hover:bg-white/10"
            title="Tutup"
            aria-label="Tutup dialog"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Pembungkus tabel responsif. */
export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-white/10">
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn('border-b border-slate-100 px-4 py-2.5 align-top dark:border-white/5', className)}>{children}</td>;
}

/** Kontrol paginasi. */
export function Pagination({
  page,
  limit,
  total,
  onPage,
}: {
  page: number;
  limit: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-sm">
      <p className="text-slate-500 dark:text-slate-400">
        {from}–{to} dari {total}
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ←
        </Button>
        <span className="px-1 font-bold">
          {page}/{pages}
        </span>
        <Button type="button" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          →
        </Button>
      </div>
    </div>
  );
}

/** Status aktif/nonaktif. */
export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold',
        active ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' : 'bg-slate-500/15 text-slate-500 dark:text-slate-400',
      )}
    >
      {active ? 'Aktif' : 'Nonaktif'}
    </span>
  );
}
