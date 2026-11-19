import { z } from 'zod';
import { ATTENDANCE_STATUSES, INTEGRITY_TYPES, QUESTION_TYPES, ROLES, SCORING_MODES, SESSION_STATUSES } from './enums';

/** Login: username (NISN untuk siswa) + password. Role diambil dari path /login/:role. */
export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username/NISN wajib diisi'),
  password: z.string().min(1, 'Password wajib diisi'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const roleParamSchema = z.object({
  role: z.enum(ROLES),
});
export type RoleParam = z.infer<typeof roleParamSchema>;

/** Payload JWT (ringkas, tanpa data sensitif). */
export const jwtPayloadSchema = z.object({
  sub: z.string(), // user id
  username: z.string(),
  name: z.string(),
  role: z.enum(ROLES),
  /** Sekolah akun. null untuk admin yang mengelola semua sekolah. */
  schoolId: z.string().nullable().optional(),
});
export type JwtPayload = z.infer<typeof jwtPayloadSchema>;

/** Ringkasan sekolah yang menyertai respons auth — dasar branding di web. */
export const schoolSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  appName: z.string(),
  tahunAjaran: z.string().nullable().optional(),
  headmasterName: z.string().nullable().optional(),
  headmasterNip: z.string().nullable().optional(),
  hasLogo: z.boolean().optional(),
});
export type SchoolSummary = z.infer<typeof schoolSummarySchema>;

/** Respons login ke client. */
export const authResponseSchema = z.object({
  accessToken: z.string(),
  user: z.object({
    id: z.string(),
    username: z.string(),
    name: z.string(),
    role: z.enum(ROLES),
    kelasId: z.string().nullable().optional(),
    school: schoolSummarySchema.nullable().optional(),
  }),
  /** Token pembaruan — dipakai klien saat token akses kedaluwarsa (ujian bisa berjam-jam). */
  refreshToken: z.string().optional(),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

/** Tukar refresh token dengan access token baru. */
export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token wajib diisi'),
});
export type RefreshRequestInput = z.infer<typeof refreshRequestSchema>;

/* ------------------------------------------------------------------ */
/* Fase 1 — Admin: pengguna, kelas, mapel, konfigurasi                 */
/* ------------------------------------------------------------------ */

/** Format tahun ajaran: "2026/2027". */
export const tahunAjaranSchema = z
  .string()
  .trim()
  .regex(/^\d{4}\/\d{4}$/, 'Format tahun ajaran: YYYY/YYYY (cth. 2026/2027)');

const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username minimal 3 karakter')
  .max(32, 'Username maksimal 32 karakter')
  .regex(/^[A-Za-z0-9._-]+$/, 'Username hanya huruf, angka, titik, strip, underscore');

const nisnSchema = z
  .string()
  .trim()
  .regex(/^\d{10}$/, 'NISN harus 10 digit angka');

/** Buat pengguna baru (admin). Siswa wajib NISN + kelas. */
export const userCreateSchema = z
  .object({
    username: usernameSchema,
    password: z.string().min(6, 'Password minimal 6 karakter').max(72),
    name: z.string().trim().min(1, 'Nama wajib diisi').max(100),
    role: z.enum(ROLES),
    nisn: nisnSchema.nullable().optional(),
    kelasId: z.string().cuid('Kelas tidak valid').nullable().optional(),
    ruang: z.string().trim().max(30, 'Ruang maksimal 30 karakter').nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.role === 'SISWA') {
      if (!v.nisn) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nisn'], message: 'Siswa wajib punya NISN' });
      }
      if (!v.kelasId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kelasId'], message: 'Siswa wajib punya kelas' });
      }
      if (v.username !== v.nisn) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['username'],
          message: 'Username siswa harus sama dengan NISN',
        });
      }
    }
  });
export type UserCreateInput = z.infer<typeof userCreateSchema>;

/** Ubah pengguna (username tidak bisa diubah). */
export const userUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Nama wajib diisi').max(100).optional(),
  role: z.enum(ROLES).optional(),
  nisn: nisnSchema.nullable().optional(),
  kelasId: z.string().cuid('Kelas tidak valid').nullable().optional(),
  ruang: z.string().trim().max(30, 'Ruang maksimal 30 karakter').nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

/** Reset password oleh admin. */
export const passwordResetSchema = z.object({
  newPassword: z.string().min(6, 'Password minimal 6 karakter').max(72),
});
export type PasswordResetInput = z.infer<typeof passwordResetSchema>;

/** Query list pengguna (paginasi + filter). */
const booleanQuery = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean().optional(),
);
export const userListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  role: z.enum(ROLES).optional(),
  kelasId: z.string().optional(),
  isActive: booleanQuery,
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

/** Satu baris hasil import Excel pengguna. */
export const userImportRowSchema = z.object({
  username: usernameSchema,
  password: z.string().min(6, 'Password minimal 6 karakter').max(72),
  name: z.string().trim().min(1).max(100),
  role: z.enum(ROLES),
  nisn: z.string().trim().optional(),
  kelasName: z.string().trim().optional(),
});
export type UserImportRow = z.infer<typeof userImportRowSchema>;

/** Kelas. */
export const kelasCreateSchema = z.object({
  name: z.string().trim().min(1, 'Nama kelas wajib diisi').max(64),
  tingkat: z.enum(['X', 'XI', 'XII']).nullable().optional(),
  tahunAjaran: tahunAjaranSchema,
  /** Ruang ujian — dicetak di Kartu Login. */
  ruang: z.string().trim().max(16).nullish(),
});
export type KelasCreateInput = z.infer<typeof kelasCreateSchema>;

export const kelasUpdateSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  tingkat: z.enum(['X', 'XI', 'XII']).nullable().optional(),
  tahunAjaran: tahunAjaranSchema.optional(),
  ruang: z.string().trim().max(16).nullable().optional(),
});
export type KelasUpdateInput = z.infer<typeof kelasUpdateSchema>;

/** Mata pelajaran. */
export const mapelCreateSchema = z.object({
  name: z.string().trim().min(1, 'Nama mapel wajib diisi').max(100),
  code: z
    .string()
    .trim()
    .max(16, 'Kode maksimal 16 karakter')
    .regex(/^[A-Za-z0-9-]+$/, 'Kode hanya huruf, angka, strip')
    .nullable()
    .optional(),
});
export type MapelCreateInput = z.infer<typeof mapelCreateSchema>;

export const mapelUpdateSchema = mapelCreateSchema.partial();
export type MapelUpdateInput = z.infer<typeof mapelUpdateSchema>;

/** KKM mata pelajaran — diatur guru pemilik mapel (skala 0–100). */
export const mapelKkmSchema = z.object({
  kkm: z.coerce.number().min(0, 'KKM minimal 0').max(100, 'KKM maksimal 100'),
});
export type MapelKkmInput = z.infer<typeof mapelKkmSchema>;

/**
 * Konfigurasi per sekolah (upsert per key). Key dibatasi agar tak bisa sembarang.
 * Branding (nama sekolah / appName / kepala sekolah) BUKAN config — ada di
 * tabel School lewat PATCH /settings/school.
 */
export const CONFIG_KEYS = [
  'TOKEN_DEFAULT_INTERVAL_SEC',
  'MAX_VIOLATIONS_DEFAULT',
  'REQUIRE_SEB_DEFAULT',
  'KKM_DEFAULT',
  'TAHUN_AJARAN',
] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

export const configUpsertSchema = z.object({
  key: z.enum(CONFIG_KEYS),
  value: z.string().trim().min(1, 'Nilai wajib diisi').max(500),
});
export type ConfigUpsertInput = z.infer<typeof configUpsertSchema>;

/**
 * PIN keluar APK SEB (per sekolah) — diatur admin di Pengaturan. Ditulis ke
 * GlobalConfig sebagai SHA-256 hex (tidak pernah dikembalikan mentah).
 * Generic upsert TIDAK mendukung key ini (lihat upsert di SettingsService).
 */
export const sebExitPinSchema = z.object({
  pin: z.string().regex(/^\d{4,8}$/, 'PIN harus 4–8 angka'),
});
export type SebExitPinInput = z.infer<typeof sebExitPinSchema>;

/** Payload dari APK SEB untuk verifikasi PIN keluar (publik, rate-limited). */
export const sebExitVerifySchema = z.object({
  pin: z.string().trim().min(1).max(32),
  school: z.string().trim().max(64).optional(),
});
export type SebExitVerifyInput = z.infer<typeof sebExitVerifySchema>;

/** Identitas sekolah (branding) — dikelola admin, dipakai di PDF & header. */
export const schoolUpdateSchema = z.object({
  name: z.string().trim().min(3, 'Nama sekolah minimal 3 karakter').max(120),
  appName: z.string().trim().min(3, 'Nama aplikasi minimal 3 karakter').max(120),
  headmasterName: z.string().trim().max(120).nullish(),
  headmasterNip: z.string().trim().max(40).nullish(),
});
export type SchoolUpdateInput = z.infer<typeof schoolUpdateSchema>;

/** Query audit log. */
export const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  action: z.string().trim().max(64).optional(),
  entity: z.string().trim().max(64).optional(),
  actorId: z.string().optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

/* ------------------------------------------------------------------ */
/* Fase 2 — Bank soal (5 tipe)                                         */
/* ------------------------------------------------------------------ */

export const choiceSchema = z.object({
  id: z.string().trim().min(1).max(32),
  label: z.string().trim().min(1, 'Label opsi wajib diisi').max(1000),
  imageUrl: z.string().trim().max(500).nullable().optional(),
});
export type Choice = z.infer<typeof choiceSchema>;

const questionBase = {
  content: z.string().trim().min(1, 'Teks soal wajib diisi').max(10000),
  imageUrl: z.string().trim().max(500).nullable().optional(),
  weight: z.coerce.number().min(0.5, 'Bobot minimal 0,5').max(100, 'Bobot maksimal 100').default(1),
  scoringMode: z.enum(SCORING_MODES).default('ALL_OR_NOTHING'),
  explanation: z.string().trim().max(5000).nullable().optional(),
};

function uniqueIds(ids: string[]): boolean {
  return new Set(ids).size === ids.length;
}

/** PG: tepat 1 kunci dari opsi. */
const pgSchema = z
  .object({
    ...questionBase,
    type: z.literal('PG'),
    choices: z.array(choiceSchema).min(2, 'Minimal 2 opsi').max(10, 'Maksimal 10 opsi'),
    correctChoices: z.array(z.string()).length(1, 'PG wajib tepat 1 kunci jawaban'),
  })
  .superRefine((v, ctx) => {
    if (!uniqueIds(v.choices.map((c) => c.id))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['choices'], message: 'ID opsi harus unik' });
    }
    if (!v.choices.some((c) => c.id === v.correctChoices[0])) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['correctChoices'], message: 'Kunci harus salah satu opsi' });
    }
  });

/** PG Kompleks: ≥1 kunci dari opsi. */
const pgKompleksSchema = z
  .object({
    ...questionBase,
    type: z.literal('PG_KOMPLEKS'),
    choices: z.array(choiceSchema).min(2, 'Minimal 2 opsi').max(10, 'Maksimal 10 opsi'),
    correctChoices: z.array(z.string()).min(1, 'Minimal 1 kunci jawaban').max(10),
  })
  .superRefine((v, ctx) => {
    if (!uniqueIds(v.choices.map((c) => c.id))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['choices'], message: 'ID opsi harus unik' });
    }
    const ids = new Set(v.choices.map((c) => c.id));
    if (!v.correctChoices.every((id) => ids.has(id))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['correctChoices'], message: 'Semua kunci harus berasal dari opsi' });
    }
  });

const pairSideSchema = z.object({
  id: z.string().trim().min(1).max(32),
  text: z.string().trim().min(1, 'Teks pasangan wajib diisi').max(500),
});

/** Matching: tiap kiri punya tepat 1 pasangan kanan. */
const matchingSchema = z
  .object({
    ...questionBase,
    type: z.literal('MATCHING'),
    pairs: z.object({
      left: z.array(pairSideSchema).min(2, 'Minimal 2 item kiri').max(10),
      right: z.array(pairSideSchema).min(2, 'Minimal 2 item kanan').max(10),
      mapping: z.record(z.string(), z.string()),
    }),
  })
  .superRefine((v, ctx) => {
    const { left, right, mapping } = v.pairs;
    if (!uniqueIds(left.map((x) => x.id)) || !uniqueIds(right.map((x) => x.id))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pairs'], message: 'ID tiap sisi harus unik' });
    }
    const rightIds = new Set(right.map((x) => x.id));
    for (const l of left) {
      const target = mapping[l.id];
      if (!target) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pairs', 'mapping'], message: `Item kiri "${l.text}" belum punya pasangan` });
      } else if (!rightIds.has(target)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pairs', 'mapping'], message: 'Pasangan harus merujuk item kanan yang ada' });
      }
    }
  });

const statementSchema = z.object({
  id: z.string().trim().min(1).max(32),
  text: z.string().trim().min(1, 'Teks pernyataan wajib diisi').max(1000),
  answer: z.boolean(),
});

/** Benar–Salah: tiap pernyataan punya kunci boolean. */
const benarSalahSchema = z
  .object({
    ...questionBase,
    type: z.literal('BENAR_SALAH'),
    statements: z.array(statementSchema).min(1, 'Minimal 1 pernyataan').max(10),
  })
  .superRefine((v, ctx) => {
    if (!uniqueIds(v.statements.map((s) => s.id))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['statements'], message: 'ID pernyataan harus unik' });
    }
  });

/** Isian singkat: ≥1 kunci (cocok case-insensitive, multi-kunci). */
const isianSchema = z.object({
  ...questionBase,
  type: z.literal('ISIAN_SINGKAT'),
  acceptedAnswers: z
    .array(z.string().trim().min(1, 'Kunci tidak boleh kosong').max(200))
    .min(1, 'Minimal 1 kunci jawaban')
    .max(10),
  scoringMode: z.literal('ALL_OR_NOTHING').default('ALL_OR_NOTHING'),
});

/** Buat soal — union per tipe beserta kunci (superRefine butuh ZodEffects, tak muat di discriminatedUnion). */
export const questionCreateSchema = z.union([
  pgSchema,
  pgKompleksSchema,
  matchingSchema,
  benarSalahSchema,
  isianSchema,
]);
export type QuestionCreateInput = z.infer<typeof questionCreateSchema>;

/** Ubah soal = ganti penuh (termasuk boleh ganti tipe). */
export const questionUpdateSchema = questionCreateSchema;
export type QuestionUpdateInput = z.infer<typeof questionUpdateSchema>;

/** Query list soal. */
export const questionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  type: z.enum(QUESTION_TYPES).optional(),
  mine: z.preprocess((v) => (v === 'false' ? false : v === '0' ? false : v === undefined ? undefined : true), z.boolean().optional()),
});
export type QuestionListQuery = z.infer<typeof questionListQuerySchema>;

/** Satu baris hasil import soal. */
export const questionImportRowSchema = z.object({
  type: z.enum(QUESTION_TYPES),
  content: z.string().trim().min(1, 'Teks soal wajib diisi').max(10000),
  weight: z.coerce.number().min(0.5).max(100).default(1),
  scoringMode: z.enum(SCORING_MODES).default('ALL_OR_NOTHING'),
  explanation: z.string().trim().max(5000).nullable().optional(),
  /** Kunci jawaban, dipisah koma. Untuk PG: 1 kunci; PG_KOMPLEKS: ≥1; ISIAN: alternatif jawaban. */
  correctChoices: z.array(z.string().trim().min(1).max(64)).optional(),
  acceptedAnswers: z.array(z.string().trim().min(1).max(200)).optional(),
  /** PG opsi: "A|teks;B|teks;C|teks" — maks 10 opsi, ID wajib unik. */
  choices: z.string().trim().max(10000).optional(),
  /** MATCHING kiri: "1|teks;2|teks" atau "kiri=kanan;kiri2=kanan2" (kanan ditulis teks). */
  pairs: z.string().trim().max(10000).optional(),
  /** BENAR_SALAH: "peringatan|B/S;peringatan2|B/S" — maks 10. */
  statements: z.string().trim().max(10000).optional(),
});
export type QuestionImportRow = z.infer<typeof questionImportRowSchema>;

/* ------------------------------------------------------------------ */
/* Fase 3 — Ujian (exam) + sesi                                        */
/* ------------------------------------------------------------------ */

/** Ujian: judul + mapel. Soal dikelola lewat endpoint relasi. */
export const examCreateSchema = z.object({
  title: z.string().trim().min(1, 'Judul ujian wajib diisi').max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  mapelId: z.string().min(1, 'Mapel wajib dipilih'),
});
export type ExamCreateInput = z.infer<typeof examCreateSchema>;

export const examUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  mapelId: z.string().min(1).optional(),
});
export type ExamUpdateInput = z.infer<typeof examUpdateSchema>;

/** Susun soal ujian: daftar ID berurutan (tanpa duplikat, maks 200). */
export const examQuestionsSetSchema = z.object({
  questionIds: z
    .array(z.string().min(1))
    .min(1, 'Minimal 1 soal')
    .max(200, 'Maksimal 200 soal')
    .superRefine((ids, ctx) => {
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Soal tidak boleh duplikat' });
      }
    }),
});
export type ExamQuestionsSetInput = z.infer<typeof examQuestionsSetSchema>;

export const examListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  mapelId: z.string().optional(),
  mine: z.preprocess((v) => (v === 'false' ? false : v === '0' ? false : v === undefined ? undefined : true), z.boolean().optional()),
});
export type ExamListQuery = z.infer<typeof examListQuerySchema>;

const datetimeSchema = z.coerce.date({ error: 'Tanggal tidak valid' });

/** Hari pelaksanaan ujian (model mingguan: Senin–Jumat). */
export const DAY_NAMES = ['SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT'] as const;
export const daySchema = z.enum(DAY_NAMES);
export type DayName = z.infer<typeof daySchema>;

/** Sesi ujian: jadwal + durasi + aturan. tokenSecret dibuat server (dipakai TOTP Fase 4). */
export const sessionCreateSchema = z
  .object({
    examId: z.string().min(1, 'Ujian wajib dipilih'),
    title: z.string().trim().max(200).nullable().optional(),
    /** Hari pelaksanaan (Senin–Jumat). Opsional demi kompatibilitas data lama. */
    hariPelaksanaan: daySchema.nullable().optional(),
    startsAt: datetimeSchema.nullable().optional(),
    endsAt: datetimeSchema.nullable().optional(),
    durationMin: z.coerce.number().int().min(5, 'Durasi minimal 5 menit').max(480, 'Durasi maksimal 480 menit'),
    // Opsional — bila kosong, server memakai konfigurasi global (Pengaturan).
    tokenIntervalSec: z.coerce.number().int().min(30).max(600).optional(),
    maxViolations: z.coerce.number().int().min(0).max(20).optional(),
    requireSeb: z.boolean().optional(),
    shuffleQuestions: z.boolean().default(true),
    shuffleOptions: z.boolean().default(true),
    kelasIds: z.array(z.string().min(1)).max(50).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.startsAt && v.endsAt && v.startsAt >= v.endsAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'Waktu selesai harus setelah mulai' });
    }
  });
export type SessionCreateInput = z.infer<typeof sessionCreateSchema>;

export const sessionUpdateSchema = z
  .object({
    title: z.string().trim().max(200).nullable().optional(),
    hariPelaksanaan: daySchema.nullable().optional(),
    startsAt: datetimeSchema.nullable().optional(),
    endsAt: datetimeSchema.nullable().optional(),
    durationMin: z.coerce.number().int().min(5).max(480).optional(),
    tokenIntervalSec: z.coerce.number().int().min(30).max(600).optional(),
    maxViolations: z.coerce.number().int().min(0).max(20).optional(),
    requireSeb: z.boolean().optional(),
    shuffleQuestions: z.boolean().optional(),
    shuffleOptions: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.startsAt && v.endsAt && v.startsAt >= v.endsAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'Waktu selesai harus setelah mulai' });
    }
  });
export type SessionUpdateInput = z.infer<typeof sessionUpdateSchema>;

/** Kelas peserta sesi. */
export const sessionKelasSetSchema = z.object({
  kelasIds: z.array(z.string().min(1)).max(50),
});
export type SessionKelasSetInput = z.infer<typeof sessionKelasSetSchema>;

/** Kompatibilitas: /status lama → dipetakan ke visibilitas (lihat ExamSessionsService.setStatus). */
export const sessionStatusSchema = z.object({
  status: z.enum(SESSION_STATUSES),
});
export type SessionStatusInput = z.infer<typeof sessionStatusSchema>;

/** Toggle tampil ke siswa — menggantikan alur DRAFT→SCHEDULED→ACTIVE→CLOSED. */
export const sessionVisibilitySchema = z.object({
  visible: z.boolean(),
});
export type SessionVisibilityInput = z.infer<typeof sessionVisibilitySchema>;

export const sessionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  examId: z.string().optional(),
  status: z.enum(SESSION_STATUSES).optional(),
  /** Filter visibilitas untuk siswa (true = tampil ke siswa). */
  visible: z.preprocess((v) => (v === 'false' ? false : v === '0' ? false : v === undefined ? undefined : true), z.boolean().optional()),
  /** Filter hari pelaksanaan (Senin–Jumat). */
  hari: daySchema.optional(),
  mine: z.preprocess((v) => (v === 'false' ? false : v === '0' ? false : v === undefined ? undefined : true), z.boolean().optional()),
});
export type SessionListQuery = z.infer<typeof sessionListQuerySchema>;

/* ------------------------------------------------------------------ */
/* Fase 4 — Proktor: token, absensi, kartu                              */
/* ------------------------------------------------------------------ */

/** Token 6 digit yang diketik siswa. */
export const tokenVerifySchema = z.object({
  token: z.string().trim().regex(/^\d{6}$/, 'Token harus 6 digit angka'),
});
export type TokenVerifyInput = z.infer<typeof tokenVerifySchema>;

/** Rilis token ke papan proktor (dicatat di audit). */
export const tokenReleaseSchema = z.object({
  note: z.string().trim().max(200).nullable().optional(),
});
export type TokenReleaseInput = z.infer<typeof tokenReleaseSchema>;

/**
 * Simpan absensi massal (satu entri per peserta).
 * Status `BELUM` = kosongkan absensi peserta (baris dihapus) — dipakai saat
 * proktor memperbaiki salah tanda; bukan status absensi tersendiri.
 */
export const attendanceSetSchema = z.object({
  items: z
    .array(
      z.object({
        userId: z.string().min(1),
        status: z.union([z.enum(ATTENDANCE_STATUSES), z.literal('BELUM')]),
        note: z.string().trim().max(200).nullable().optional(),
      }),
    )
    .min(1, 'Minimal 1 peserta')
    .max(2000),
});
export type AttendanceSetInput = z.infer<typeof attendanceSetSchema>;

/** Set enrol peserta ujian (replace penuh — idempoten). */
export const examEnrollSchema = z.object({
  userIds: z.array(z.string().min(1)).max(3000, 'Maksimal 3000 peserta'),
});
export type ExamEnrollInput = z.infer<typeof examEnrollSchema>;

/** Kandidat enrol: siswa aktif, dicari per nama/NISN/username, opsional per kelas/sesi. */
export const examCandidatesQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  kelasId: z.string().optional(),
  /** Batasi kandidat ke kelas peserta sesi (panel enrol di konteks sesi). */
  sessionId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ExamCandidatesQuery = z.infer<typeof examCandidatesQuerySchema>;

/* ------------------------------------------------------------------ */
/* Fase 5 — Ruang ujian siswa: gate token, attempt, autosave, integritas*/
/* ------------------------------------------------------------------ */

/** Mulai attempt: gerbang token 6 digit. */
export const attemptStartSchema = z.object({
  sessionId: z.string().min(1, 'Sesi wajib diisi'),
  token: z.string().trim().regex(/^\d{6}$/, 'Token harus 6 digit angka'),
  /**
   * Laporan klien (advisory). Server TIDAK memakai field ini untuk sesi wajib
   * SEB; verifikasi memakai header X-SafeExamBrowser-RequestHash.
   */
  seb: z.boolean().optional(),
});
export type AttemptStartInput = z.infer<typeof attemptStartSchema>;

/**
 * Simpan satu jawaban (autosave). Bentuk `payload` bergantung tipe soal:
 * - PG: string (id opsi) | null
 * - PG_KOMPLEKS: string[] (id opsi terpilih)
 * - BENAR_SALAH: Record<id, boolean>
 * - MATCHING: Record<leftId, rightId>
 * - ISIAN_SINGKAT: string
 */
export const answerSaveSchema = z.object({
  questionId: z.string().min(1, 'Soal wajib diisi'),
  /** Boleh tidak ada — artinya klien hanya mengubah tanda "ragu-ragu". */
  payload: z.unknown().optional(),
  isFlagged: z.boolean().optional(),
});
export type AnswerSaveInput = z.infer<typeof answerSaveSchema>;

/** Catat pelanggaran integritas (tab switch, keluar fullscreen, copy, dsb). */
export const attemptIntegritySchema = z.object({
  type: z.enum(INTEGRITY_TYPES),
  detail: z.record(z.string(), z.unknown()).optional(),
});
export type AttemptIntegrityInput = z.infer<typeof attemptIntegritySchema>;

/** Buka attempt terkunci (batas pelanggaran) — pakai token sesi dari proktor. */
export const attemptUnlockSchema = z.object({
  token: z.string().trim().regex(/^\d{6}$/, 'Token harus 6 digit'),
});
export type AttemptUnlockInput = z.infer<typeof attemptUnlockSchema>;

/** Kirim attempt (submit manual; server juga auto-submit saat waktu habis). */
export const attemptSubmitSchema = z.object({
  reason: z.enum(['MANUAL', 'TIMEOUT', 'FORCED']).default('MANUAL'),
});
export type AttemptSubmitInput = z.infer<typeof attemptSubmitSchema>;

/** Ganti password mandiri (Fase 5). */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Password saat ini wajib diisi'),
  newPassword: z.string().min(6, 'Password baru minimal 6 karakter').max(72, 'Password maksimal 72 karakter'),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/* ------------------------------------------------------------------ */
/* Fase 6 — Monitoring realtime + kendali attempt                     */
/* ------------------------------------------------------------------ */

/** Peringatan proktor ke siswa (dikirim realtime, juga dicatat sebagai integritas). */
export const monitorWarnSchema = z.object({
  message: z.string().trim().min(1, 'Isi peringatan wajib diisi').max(200, 'Maksimal 200 karakter'),
});
export type MonitorWarnInput = z.infer<typeof monitorWarnSchema>;

/** Perpanjang waktu pengerjaan per peserta (menit). */
export const monitorExtendSchema = z.object({
  minutes: z.coerce.number().int().min(1, 'Minimal 1 menit').max(120, 'Maksimal 120 menit'),
  note: z.string().trim().max(200).nullable().optional(),
});
export type MonitorExtendInput = z.infer<typeof monitorExtendSchema>;

/* ------------------------------------------------------------------ */
/* Fase 7 — penilaian, review manual, publish hasil, analisis butir    */
/* ------------------------------------------------------------------ */

/**
 * Review manual satu butir jawaban (terutama ISIAN_SINGKAT yang tidak
 * cocok dengan kunci mana pun). Batas atas skor = bobot soal, divalidasi server.
 */
export const answerReviewSchema = z.object({
  questionId: z.string().min(1, 'Soal wajib diisi'),
  score: z.coerce.number().min(0, 'Skor tidak boleh negatif'),
  note: z.string().trim().max(500).nullable().optional(),
});
export type AnswerReviewInput = z.infer<typeof answerReviewSchema>;

/** Terbitkan / tarik hasil ujian ke siswa. Publish butuh sesi berstatus CLOSED. */
export const resultsPublishSchema = z.object({
  published: z.boolean(),
});
export type ResultsPublishInput = z.infer<typeof resultsPublishSchema>;

/* ------------------------------------------------------------------ */
/* Remedial — reset/hapus attempt per siswa                            */
/* ------------------------------------------------------------------ */

/** Reset attempt satu siswa (remedial): siswa bisa mengerjakan ulang. */
export const attemptResetSchema = z.object({
  reason: z.string().trim().max(500).nullable().optional(),
});
export type AttemptResetInput = z.infer<typeof attemptResetSchema>;

