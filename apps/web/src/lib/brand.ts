import { useAuth } from '../auth/AuthContext';

export interface Brand {
  SCHOOL_NAME: string;
  APP_NAME: string;
  TAHUN_AJARAN: string;
}

/** Brand gabungan dua sekolah — dipakai di halaman login & mode agregat. */
export const GENERIC_BRAND: Brand = {
  SCHOOL_NAME: 'SMAN 1 & 8 Gorontalo',
  APP_NAME: 'CBT SMAN 1 & 8 GORONTALO',
  TAHUN_AJARAN: '2026/2027',
};

/** Brand mengikuti sekolah akun yang login; generik bila belum login / mode agregat. */
export function useBrand(): Brand {
  const { user } = useAuth();
  const s = user?.school;
  if (!s) return GENERIC_BRAND;
  return {
    SCHOOL_NAME: s.name,
    APP_NAME: s.appName,
    TAHUN_AJARAN: s.tahunAjaran ?? GENERIC_BRAND.TAHUN_AJARAN,
  };
}
