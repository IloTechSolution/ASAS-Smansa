/** Enum & konstanta domain — satu sumber kebenaran untuk API dan Web. */

export const ROLES = ['ADMIN', 'GURU', 'SISWA', 'PROKTOR'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Admin',
  GURU: 'Guru',
  SISWA: 'Siswa',
  PROKTOR: 'Proktor',
};

/** Warna aksen tiap role (turunan palet logo sekolah). */
export const ROLE_ACCENT: Record<Role, string> = {
  ADMIN: '#1B7FE0', // biru azure
  GURU: '#B8860B', // emas (digelapkan agar kontras di light mode)
  SISWA: '#0E9FD8', // cyan
  PROKTOR: '#16A34A', // hijau globe
};

/** Dashboard tujuan setelah login per role. */
export const ROLE_HOME: Record<Role, string> = {
  ADMIN: '/app/admin',
  GURU: '/app/guru',
  SISWA: '/app/siswa',
  PROKTOR: '/app/proktor',
};

export const QUESTION_TYPES = [
  'PG',
  'PG_KOMPLEKS',
  'MATCHING',
  'BENAR_SALAH',
  'ISIAN_SINGKAT',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  PG: 'Pilihan Ganda',
  PG_KOMPLEKS: 'Pilihan Ganda Kompleks',
  MATCHING: 'Mencocokkan (Matching)',
  BENAR_SALAH: 'Benar–Salah',
  ISIAN_SINGKAT: 'Isian Singkat',
};

export const SCORING_MODES = ['ALL_OR_NOTHING', 'PROPORSIONAL'] as const;
export type ScoringMode = (typeof SCORING_MODES)[number];

export const SCORING_MODE_LABEL: Record<ScoringMode, string> = {
  ALL_OR_NOTHING: 'Benar semua atau nol',
  PROPORSIONAL: 'Proporsional per item',
};

export const ATTEMPT_STATUSES = [
  'IN_PROGRESS',
  'SUBMITTED',
  'EXPIRED',
  'FORCE_SUBMITTED',
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const SESSION_STATUSES = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'CLOSED'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const ATTENDANCE_STATUSES = ['HADIR', 'TERLAMBAT', 'IZIN', 'SAKIT', 'ALPA'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const INTEGRITY_TYPES = [
  'TAB_SWITCH',
  'FULLSCREEN_EXIT',
  'WINDOW_BLUR',
  'COPY_ATTEMPT',
  'PASTE_ATTEMPT',
  'CONTEXT_MENU',
  'SEB_MISSING',
  'DEVTOOLS_OPEN',
  'OTHER',
] as const;
export type IntegrityType = (typeof INTEGRITY_TYPES)[number];
