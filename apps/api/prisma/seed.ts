/**
 * Seed awal CBT SMAN 1 & SMAN 8 Gorontalo (multi-sekolah).
 * - Development: konfigurasi, sekolah, kelas/mapel contoh, dan akun demo per sekolah.
 * - Produksi (SEED_DEMO=false): hanya konfigurasi default + satu akun admin
 *   dari SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD (sekolah: SMAN 1; admin
 *   mengelola kedua sekolah lewat switcher di aplikasi).
 *
 * Jalankan: npm run seed -w @cbt/api
 */
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { createCipheriv, createHash, randomBytes } from 'crypto';

const prisma = new PrismaClient();

/** Enkripsi at-rest `initialPassword` — format sama dengan
 * `src/common/crypto/secret-box.ts`. Tidak meng-import dari src karena image
 * runtime hanya memuat `dist/` + `prisma/`. */
const encryptSecret = (plain: string): string => {
  const secret = process.env.INITIAL_PASSWORD_SECRET ?? process.env.JWT_SECRET;
  if (!secret) throw new Error('INITIAL_PASSWORD_SECRET / JWT_SECRET belum diisi');
  const key = createHash('sha256').update(secret, 'utf8').digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64')}.${tag.toString('base64')}.${data.toString('base64')}`;
};

const uploadsRoot = () => resolve(process.env.UPLOAD_DIR ?? './uploads');

const configs: Array<[string, string]> = [
  ['TOKEN_DEFAULT_INTERVAL_SEC', '120'],
  ['MAX_VIOLATIONS_DEFAULT', '3'],
  ['REQUIRE_SEB_DEFAULT', 'false'],
  ['KKM_DEFAULT', '75'],
  ['TAHUN_AJARAN', '2026/2027'],
];
// SCHOOL_NAME & APP_NAME tidak dipakai lagi — branding hidup di tabel School.

async function seedSchools() {
  const sman1 = await prisma.school.upsert({
    where: { slug: 'sman1' },
    update: {},
    create: {
      id: 'sman1',
      slug: 'sman1',
      name: 'SMAN 1 Gorontalo',
      appName: 'CBT SMAN 1 Gorontalo',
      headmasterName: 'Dra. Adianiwaty S. Polapa, M.Pd',
      headmasterNip: '196810131994122006',
      logoPath: 'branding/sman1/logo.png',
    },
  });
  const sman8 = await prisma.school.upsert({
    where: { slug: 'sman8' },
    update: {},
    create: {
      id: 'sman8',
      slug: 'sman8',
      name: 'SMAN 8 Gorontalo',
      appName: 'CBT SMAN 8 Gorontalo',
    },
  });

  // Logo SMAN 1 dari aset repo → uploads (volume), idempoten.
  // Migrasi logo bawaan lama (sman1/logo.jpeg) → logo.png baru — tanpa menghapus
  // logo yang diunggah admin ke key logo.png.
  const sman1Now = await prisma.school.findUnique({ where: { slug: 'sman1' }, select: { logoPath: true } });
  if (sman1Now?.logoPath === 'branding/sman1/logo.jpeg') {
    await prisma.school.update({ where: { slug: 'sman1' }, data: { logoPath: 'branding/sman1/logo.png' } });
    console.log('[seed] Logo SMAN 1: migrasi logoPath logo.jpeg → logo.png');
  }
  const logoSrc = join(__dirname, '..', 'assets', 'school', 'sman1.png');
  const logoDest = join(uploadsRoot(), 'branding', 'sman1', 'logo.png');
  if (existsSync(logoSrc) && !existsSync(logoDest)) {
    mkdirSync(dirname(logoDest), { recursive: true });
    copyFileSync(logoSrc, logoDest);
    console.log('[seed] Logo SMAN 1 disalin ke uploads/branding/sman1/logo.png');
  }

  return { sman1, sman8 };
}

async function seedConfigs(schoolIds: Array<'sman1' | 'sman8'>) {
  for (const schoolId of schoolIds) {
    for (const [key, value] of configs) {
      await prisma.globalConfig.upsert({
        where: { schoolId_key: { schoolId, key } },
        update: {},
        create: { schoolId, key, value },
      });
    }
  }
}

const accountsBySchool: Array<{
  schoolId: 'sman1' | 'sman8';
  accounts: Array<{ username: string; password: string; name: string; role: 'ADMIN' | 'GURU' | 'SISWA' | 'PROKTOR'; nisn: string | null; kelasName: string | null; initialPassword?: string | null }>;
}> = [
  {
    schoolId: 'sman1',
    accounts: [
      { username: 'admin', password: 'Admin123!', name: 'Administrator', role: 'ADMIN', nisn: null, kelasName: null },
      { username: 'guru', password: 'Guru123!', name: 'Guru Contoh', role: 'GURU', nisn: null, kelasName: null },
      { username: 'proktor', password: 'Proktor123!', name: 'Proktor Contoh', role: 'PROKTOR', nisn: null, kelasName: null },
      { username: '0051234567', password: 'Siswa123!', name: 'Siswa Contoh', role: 'SISWA', nisn: '0051234567', kelasName: 'XII IPA 1', initialPassword: 'Siswa123!' },
    ],
  },
  {
    schoolId: 'sman8',
    accounts: [
      { username: 'guru8', password: 'Guru123!', name: 'Guru SMAN 8', role: 'GURU', nisn: null, kelasName: null },
      { username: 'proktor8', password: 'Proktor123!', name: 'Proktor SMAN 8', role: 'PROKTOR', nisn: null, kelasName: null },
      { username: '0081234567', password: 'Siswa123!', name: 'Siswa SMAN 8', role: 'SISWA', nisn: '0081234567', kelasName: 'X-2', initialPassword: 'Siswa123!' },
    ],
  },
];

async function seedDemo() {
  const existingUsers = await prisma.user.count();
  if (existingUsers > 0) {
    console.log('[seed] Database sudah berisi pengguna; data demo dilewati.');
    // tetap pastikan akun demo SMAN 8 ada (untuk instalasi multi-sekolah baru di DB yang sudah berisi data SMAN 1)
    await ensureSman8Demo();
    return;
  }

  const kelasBySchool: Record<'sman1' | 'sman8', Array<{ name: string; tingkat: string }>> = {
    sman1: [{ name: 'XII IPA 1', tingkat: 'XII' }],
    sman8: [{ name: 'X-1', tingkat: 'X' }, { name: 'X-2', tingkat: 'X', ruang: '20' }],
  };
  for (const [schoolId, list] of Object.entries(kelasBySchool)) {
    for (const k of list) {
      await prisma.kelas.upsert({
        where: { schoolId_name: { schoolId, name: k.name } },
        update: ('ruang' in k ? { ruang: k.ruang } : {}),
        create: { name: k.name, tingkat: k.tingkat, tahunAjaran: '2026/2027', schoolId, ruang: 'ruang' in k ? k.ruang : null },
      });
    }
  }
  for (const schoolId of ['sman1', 'sman8'] as const) {
    await prisma.mapel.upsert({
      where: { schoolId_name: { schoolId, name: 'Matematika' } },
      update: {},
      create: { name: 'Matematika', code: 'MTK', schoolId },
    });
  }

  const printed: Array<{ schoolId: string; role: string; username: string; password: string }> = [];
  for (const { schoolId, accounts } of accountsBySchool) {
    for (const a of accounts) {
      const kelas = a.kelasName
        ? await prisma.kelas.findUnique({ where: { schoolId_name: { schoolId, name: a.kelasName } } })
        : null;
      await prisma.user.create({
        data: {
          username: a.username,
          password: await hash(a.password, 10),
          name: a.name,
          role: a.role,
          nisn: a.nisn,
          kelasId: kelas?.id ?? null,
          schoolId,
          initialPassword: a.initialPassword ? encryptSecret(a.initialPassword) : null,
        },
      });
      printed.push({ schoolId, role: a.role, username: a.username, password: a.password });
    }
  }

  console.log('\nSeed demo selesai. Akun DEV (ganti password setelah login!):');
  console.table(printed);
}

async function ensureSman8Demo() {
  const count = await prisma.user.count({ where: { schoolId: 'sman8' } });
  if (count > 0) {
    console.log('[seed] SMAN 8 sudah berisi pengguna; dilewati.');
    return;
  }
  for (const k of [{ name: 'X-1', ruang: null as string | null }, { name: 'X-2', ruang: '20' }]) {
    await prisma.kelas.upsert({
      where: { schoolId_name: { schoolId: 'sman8', name: k.name } },
      update: k.ruang ? { ruang: k.ruang } : {},
      create: { name: k.name, tingkat: 'X', tahunAjaran: '2026/2027', schoolId: 'sman8', ruang: k.ruang },
    });
  }
  await prisma.mapel.upsert({
    where: { schoolId_name: { schoolId: 'sman8', name: 'Matematika' } },
    update: {},
    create: { name: 'Matematika', code: 'MTK', schoolId: 'sman8' },
  });
  const sman8 = accountsBySchool.find((a) => a.schoolId === 'sman8')!;
  for (const a of sman8.accounts) {
    const kelas = a.kelasName
      ? await prisma.kelas.findUnique({ where: { schoolId_name: { schoolId: 'sman8', name: a.kelasName } } })
      : null;
    await prisma.user.create({
      data: {
        username: a.username,
        password: await hash(a.password, 10),
        name: a.name,
        role: a.role,
        nisn: a.nisn,
        kelasId: kelas?.id ?? null,
        schoolId: 'sman8',
        initialPassword: a.initialPassword ? encryptSecret(a.initialPassword) : null,
      },
    });
  }
  console.log('[seed] Akun demo SMAN 8 ditambahkan (guru8 / proktor8 / 0081234567).');
}

async function seedProductionAdmin() {
  const username = (process.env.SEED_ADMIN_USERNAME ?? 'admin').trim();
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password || password.length < 8) {
    throw new Error('SEED_ADMIN_PASSWORD wajib diisi (minimal 8 karakter) saat SEED_DEMO=false.');
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`[seed] Admin "${username}" sudah ada; password tidak diubah.`);
    return;
  }

  await prisma.user.create({
    data: {
      username,
      password: await hash(password, 10),
      name: 'Administrator',
      role: 'ADMIN',
      schoolId: 'sman1',
    },
  });
  console.log(`[seed] Admin awal "${username}" dibuat dari SEED_ADMIN_PASSWORD.`);
}

async function main() {
  // Branding tidak lagi hidup di GlobalConfig (pindah ke tabel School).
  await prisma.globalConfig.deleteMany({ where: { key: { in: ['SCHOOL_NAME', 'APP_NAME'] } } });
  await seedSchools();
  await seedConfigs(['sman1', 'sman8']);

  if (process.env.SEED_DEMO === 'false') {
    await seedProductionAdmin();
  } else {
    await seedDemo();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
