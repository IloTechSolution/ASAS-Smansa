import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

/**
 * Gambar soal dilayani lewat URL bertanda tangan (gambar bukan aset publik).
 * `<img>` tidak bisa mengirim header Authorization, jadi kita tukar path
 * `/uploads/...` menjadi URL bertanda tangan lewat endpoint /uploads/sign.
 * Hasil penukaran di-cache selama 5 jam (TTL server 6 jam); cache dibatasi
 * 300 entri agar sesi ujian panjang tidak menumbuhkan memori tanpa batas.
 */
const CACHE_MAX = 300;
const cache = new Map<string, { url: string; until: number }>();

const cachePut = (path: string, url: string) => {
  if (cache.size >= CACHE_MAX) {
    // Buang entri kedaluwarsa dulu; bila masih penuh, buang yang paling lama dimasukkan (urutan Map).
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.until <= now) cache.delete(k);
    }
    while (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
  }
  cache.set(path, { url, until: Date.now() + 5 * 60 * 60 * 1000 });
};

interface Signed {
  url: string;
  exp: number;
}

async function resolveSigned(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  try {
    const res = await apiFetch<Signed>(`/uploads/sign?path=${encodeURIComponent(path)}`);
    if (!res?.url) return null;
    cachePut(path, res.url);
    return res.url;
  } catch {
    return null;
  }
}

const cachedUrl = (path: string): string | null => {
  const hit = cache.get(path);
  return hit && hit.until > Date.now() ? hit.url : null;
};

export function UploadImg({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [resolved, setResolved] = useState<string | null>(() =>
    src.startsWith('/uploads/') ? cachedUrl(src) : src,
  );
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    let active = true;
    setFailed(false);
    if (src.startsWith('/uploads/')) {
      void resolveSigned(src).then((url) => {
        if (!active) return;
        if (url) setResolved(url);
        else setFailed(true);
      });
    } else {
      setResolved(src);
    }
    return () => {
      active = false;
    };
  }, [src]);

  useEffect(() => load(), [load]);

  if (failed) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-100/60 p-4 text-center dark:border-white/15 dark:bg-white/5 ${className ?? ''}`}>
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Gambar gagal dimuat</span>
        <button
          type="button"
          onClick={load}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600 transition hover:bg-slate-200 dark:border-white/15 dark:text-slate-300 dark:hover:bg-white/10"
        >
          Coba lagi
        </button>
      </div>
    );
  }

  if (!resolved) {
    return <div className={`animate-pulse rounded-xl bg-slate-200/70 dark:bg-white/10 ${className ?? ''}`} aria-label="Memuat gambar…" />;
  }
  return <img src={resolved} alt={alt} className={className} />;
}
