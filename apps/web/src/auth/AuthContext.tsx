import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthResponse, Role } from '@cbt/shared';
import { apiFetch, ApiError, SESSION_EXPIRED_EVENT } from '../lib/api';

export interface AuthSchool {
  id: string;
  slug: string;
  name: string;
  appName: string;
  tahunAjaran?: string | null;
  headmasterName?: string | null;
  headmasterNip?: string | null;
  hasLogo?: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  kelasId: string | null;
  /** Ruang ujian milik siswa (bukan kelas) — hanya informasi. */
  ruang?: string | null;
  kelas?: { id: string; name: string } | null;
  school?: AuthSchool | null;
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  loading: true,
  login: () => Promise.reject(new Error('not ready')),
  logout: () => undefined,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Judul tab mengikuti sekolah yang login.
  useEffect(() => {
    document.title = user?.school?.appName ?? 'CBT SMAN 1 & 8 GORONTALO';
  }, [user]);

  // Logout paksa bila API menolak access + refresh token di mana pun di app.
  useEffect(() => {
    const onExpired = () => {
      localStorage.removeItem('cbt_token');
      localStorage.removeItem('cbt_refresh');
      setUser(null);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  // Pulihkan sesi saat refresh.
  useEffect(() => {
    const token = localStorage.getItem('cbt_token');
    // Tanpa access token pun masih bisa dipulihkan lewat refresh token
    // (ujian panjang: token akses kedaluwarsa di tengah sesi).
    if (!token && !localStorage.getItem('cbt_refresh')) {
      setLoading(false);
      return;
    }
    apiFetch<AuthUser>('/auth/me')
      .then((u) => setUser(u))
      .catch((e) => {
        // Hanya 401 (setelah refresh juga gagal) yang menghapus token —
        // error sementara (jaringan/5xx) tidak boleh membuang sesi siswa.
        if (e instanceof ApiError && e.status === 401) {
          localStorage.removeItem('cbt_token');
          localStorage.removeItem('cbt_refresh');
        }
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiFetch<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    localStorage.setItem('cbt_token', res.accessToken);
    if (res.refreshToken) localStorage.setItem('cbt_refresh', res.refreshToken);
    const me = await apiFetch<AuthUser>('/auth/me');
    setUser({
      ...res.user,
      kelasId: res.user.kelasId ?? null,
      kelas: me.kelas ?? null,
      school: me.school ?? res.user.school ?? null,
    });
    return res.user as AuthUser;
  }, []);

  const logout = useCallback(() => {
    // Cabut sesi refresh di server dulu (best-effort) agar token 7-hari tak
    // bisa dipakai lagi dari PC lab bersama — baru buang token lokal.
    const rt = localStorage.getItem('cbt_refresh');
    if (rt) {
      void fetch(`${import.meta.env.VITE_API_URL ?? '/api'}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      }).catch(() => undefined);
    }
    localStorage.removeItem('cbt_token');
    localStorage.removeItem('cbt_refresh');
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
