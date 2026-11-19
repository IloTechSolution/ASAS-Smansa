import { sebRequestHash } from './seb';

export const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

/** URL absolut persis seperti yang direkonstruksi API dari x-forwarded-* + originalUrl. */
const absoluteRequestUrl = (path: string): string =>
  new URL(`${API_BASE}${path}`, window.location.href).toString();

/** Header hash SEB bila halaman berjalan di APK SEB; browser otomatis mendapat {}. */
async function sebHeader(path: string): Promise<Record<string, string>> {
  const hash = await sebRequestHash(absoluteRequestUrl(path));
  return hash ? { 'X-SafeExamBrowser-RequestHash': hash } : {};
}

/** Switcher sekolah admin: '' = semua sekolah, atau id/slug sekolah. */
export const schoolSelector = (): string => (localStorage.getItem('cbt_school_id') ?? '').trim();

/** Header sekolah â€” diabaikan server untuk non-admin. */
const schoolHeaders = (): Record<string, string> => {
  const s = schoolSelector();
  return s ? { 'x-school-id': s } : {};
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Dipancarkan saat refresh token juga ditolak â€” AuthContext menangkapnya untuk
 * logout paksa, agar UI tidak tetap menampilkan chrome terautentikasi dengan
 * sesi yang sudah mati. */
export const SESSION_EXPIRED_EVENT = 'cbt:session-expired';
const emitSessionExpired = () => window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const m = (body as { message?: unknown }).message;
    if (typeof m === 'string') return m;
    if (Array.isArray(m)) return m.filter((x) => typeof x === 'string').join('; ');
  }
  return fallback;
}

/** Tukar refresh token â†’ access token baru saat menerima 401. */
let refreshInflight: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  // Single-flight: dengan ROTASI server, 2 refresh paralel memakai jti yang
  // sama akan saling membunuh (yang kedua 401 â†’ logout semu). Satu janji
  // dipakai bersama semua pemanggil 401 yang berbarengan.
  if (!refreshInflight) {
    refreshInflight = (async () => {
      const refreshToken = localStorage.getItem('cbt_refresh');
      if (!refreshToken) return false;
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await sebHeader('/auth/refresh')) },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const data = (await parseBody(res)) as { accessToken?: string; refreshToken?: string } | null;
        if (!data?.accessToken) return false;
        localStorage.setItem('cbt_token', data.accessToken);
        if (data.refreshToken) localStorage.setItem('cbt_refresh', data.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        refreshInflight = null;
      }
    })();
  }
  return refreshInflight;
}

export async function apiFetch<T>(path: string, init?: RequestInit, _isRetry = false): Promise<T> {
  const token = localStorage.getItem('cbt_token');
  const seb = await sebHeader(path);
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...seb,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...schoolHeaders(),
      ...(init?.headers ?? {}),
    },
  });
  const body = await parseBody(res);
  if (!res.ok) {
    const isAuthPath = path.startsWith('/auth/login') || path.startsWith('/auth/refresh');
    // Token akses hanya berlaku15 menit sedangkan ujian bisa berjam-jam â€”
    // coba tukar refresh token dulu sebelum dianggap sesi berakhir.
    if (res.status === 401 && !_isRetry && !isAuthPath && (await tryRefresh())) {
      return apiFetch<T>(path, init, true);
    }
    if (res.status === 401) {
      localStorage.removeItem('cbt_token');
      localStorage.removeItem('cbt_refresh');
      emitSessionExpired();
    }
    throw new ApiError(res.status, errorMessage(body, `Request gagal (${res.status})`));
  }
  return body as T;
}

/** Untuk upload multipart (tanpa header Content-Type JSON). */
export async function apiUpload<T>(path: string, form: FormData, _isRetry = false): Promise<T> {
  const token = localStorage.getItem('cbt_token');
  const seb = await sebHeader(path);
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    body: form,
    headers: {
      ...seb,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...schoolHeaders(),
    },
  });
  const body = await parseBody(res);
  if (!res.ok) {
    // `_isRetry` mencegah pengulangan tak berujung bila server tetap 401.
    if (res.status === 401 && !_isRetry && (await tryRefresh())) {
      return apiUpload<T>(path, form, true);
    }
    if (res.status === 401) {
      localStorage.removeItem('cbt_token');
      localStorage.removeItem('cbt_refresh');
      emitSessionExpired();
    }
    const msg = body && typeof body === 'object' && 'message' in body ? (body as { message?: unknown }).message : null;
    throw new ApiError(res.status, typeof msg === 'string' ? msg : `Upload gagal (${res.status})`);
  }
  return body as T;
}

/** Unduh file biner (template Excel, PDF, dsb). */
export async function apiDownload(path: string, filename: string, _isRetry = false): Promise<void> {
  const token = localStorage.getItem('cbt_token');
  const seb = await sebHeader(path);
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      ...seb,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...schoolHeaders(),
    },
  });
  if (!res.ok) {
    if (res.status === 401 && !_isRetry && (await tryRefresh())) {
      return apiDownload(path, filename, true);
    }
    if (res.status === 401) {
      localStorage.removeItem('cbt_token');
      localStorage.removeItem('cbt_refresh');
      emitSessionExpired();
    }
    const body = await parseBody(res);
    throw new ApiError(res.status, errorMessage(body, `Unduhan gagal (${res.status})`));
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

/** Ambil berkas biner sebagai Blob (pratinjau gambar, dsb). Mengikuti auto-refresh 401. */
export async function apiBlob(path: string, _isRetry = false): Promise<Blob> {
  const token = localStorage.getItem('cbt_token');
  const seb = await sebHeader(path);
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      ...seb,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...schoolHeaders(),
    },
  });
  if (!res.ok) {
    if (res.status === 401 && !_isRetry && (await tryRefresh())) {
      return apiBlob(path, true);
    }
    if (res.status === 401) {
      localStorage.removeItem('cbt_token');
      localStorage.removeItem('cbt_refresh');
      emitSessionExpired();
    }
    const body = await parseBody(res);
    throw new ApiError(res.status, errorMessage(body, `Gagal memuat berkas (${res.status})`));
  }
  return res.blob();
}
