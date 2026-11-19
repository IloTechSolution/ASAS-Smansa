import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { RefreshCcw } from 'lucide-react';

/**
 * ErrorBoundary global — mencegah satu exception di render mematikan seluruh
 * aplikasi (penting di ruang ujian: jawaban tersimpan di server, cukup muat
 * ulang halaman untuk lanjut).
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#050B16] p-6 text-center font-sans text-slate-100">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.35em] text-gold-400">Terjadi Kesalahan</p>
          <h1 className="text-xl font-extrabold text-slate-100">Aplikasi mengalami error yang tidak terduga.</h1>
          <p className="max-w-md text-sm text-slate-400">
            Jangan panik — jawaban ujian Anda tersimpan di server. Muat ulang halaman untuk melanjutkan.
          </p>
          <pre className="max-w-lg overflow-auto rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-left text-[11px] text-red-300">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex h-11 items-center gap-2 rounded-2xl bg-gradient-to-r from-gold-300 via-gold-400 to-gold-500 px-6 text-sm font-extrabold uppercase tracking-[0.15em] text-ink-900 transition hover:brightness-110"
          >
            <RefreshCcw size={16} /> Muat ulang halaman
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
