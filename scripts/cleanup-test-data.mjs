// Bersihkan data uji yang menumpuk di DB dev (dibuat oleh scripts/verify-*.mjs).
//
//   node scripts/cleanup-test-data.mjs           → DRY-RUN (hanya laporan)
//   node scripts/cleanup-test-data.mjs --apply   → hapus data uji teridentifikasi
//
// Data TIDAK BISA dikenali dengan pasti 100% — skrip hanya menghapus yang
// jelas-jelas buatan suite uji, dan melaporkan sisanya untuk diperiksa manual.
// Yang dihapus:
//   1. User uji: NISN/username 91xxxxxxxx / 92xxxxxxxx, nama 'Audit*', 'Hard*',
//      'Uji Audit*', 'Upgrade*', 'Siswa Audit2', username guru2/0098000001/1234567890
//   2. Soal / ujian / sesi buatan user uji tersebut (cascade)
//   3. Mapel 'Audit*' tanpa ujian tersisa
//   4. Kelas 'AUDIT-TMP*' / 'Bad TA' tanpa user & tanpa sesi
// Seed (admin/guru/proktor/0051234567, XII IPA 1, Matematika) selalu dilindungi.
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const env = readFileSync(join(root, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
} catch {
  console.error('.env tidak ditemukan — pastikan DATABASE_URL tersedia');
  process.exit(1);
}

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const AGGRESSIVE = process.argv.includes('--aggressive');
const SEED_USERNAMES = new Set(['admin', 'guru', 'proktor', '0051234567']);
const SEED_KELAS = new Set(['XII IPA 1']);
const SEED_MAPEL = new Set(['Matematika']);

const stats = async () => ({
  users: await prisma.user.count(),
  siswa: await prisma.user.count({ where: { role: 'SISWA' } }),
  kelas: await prisma.kelas.count(),
  mapel: await prisma.mapel.count(),
  ujian: await prisma.exam.count(),
  sesi: await prisma.examSession.count(),
  soal: await prisma.question.count(),
});

async function main() {
  console.log(APPLY ? '== CLEANUP DATA UJI (APPLY) ==\n' : '== CLEANUP DATA UJI (DRY-RUN) ==\n');
  const before = await stats();
  console.log('Sebelum:', JSON.stringify(before));

  // 1) Kandidat user uji
  const candidates = await prisma.user.findMany({
    where: {
      AND: [
        { username: { notIn: [...SEED_USERNAMES] } },
        {
          OR: [
            { nisn: { startsWith: '91' } },
            { nisn: { startsWith: '92' } },
            { username: { startsWith: '91' } },
            { username: { startsWith: '92' } },
            { username: { in: ['guru2', '0098000001', '1234567890'] } },
            { name: { startsWith: 'Audit' } },
            { name: { startsWith: 'Hard ' } },
            { name: { startsWith: 'Uji Audit' } },
            { name: { startsWith: 'Upgrade' } },
            { name: { startsWith: 'Dup' } },
            { name: { equals: 'Beda' } },
            { name: { startsWith: 'Siswa Audit2' } },
            { name: { startsWith: 'Uji Fase' } },
            { name: { equals: 'Nama Diubah' } },
            { name: { startsWith: 'Enroll' } },
            { name: { startsWith: 'Uji Import' } },
            { name: { startsWith: 'Kelas CSV' } },
            { username: { equals: '1234567891' } },
          ],
        },
      ],
    },
    select: { id: true, username: true, name: true, role: true },
  });
  console.log(`\nUser uji teridentifikasi: ${candidates.length}`);
  for (const u of candidates.slice(0, 15)) console.log(`  - [${u.role}] ${u.username} — ${u.name}`);
  if (candidates.length > 15) console.log(`  … dan ${candidates.length - 15} lainnya`);

  const candIds = candidates.map((u) => u.id);

  // 2) Ujian/sesi/soal milik user uji
  const exams = await prisma.exam.findMany({ where: { createdById: { in: candIds } }, select: { id: true } });
  const examIds = exams.map((e) => e.id);
  const sessions = await prisma.examSession.findMany({ where: { examId: { in: examIds } }, select: { id: true } });
  const sessionIds = sessions.map((s) => s.id);
  const questions = await prisma.question.findMany({ where: { createdById: { in: candIds } }, select: { id: true } });
  const qIds = questions.map((q) => q.id);
  console.log(`\nUjian milik user uji: ${examIds.length}`);
  console.log(`Sesi milik ujian tsb:  ${sessionIds.length}`);
  console.log(`Soal milik user uji:   ${qIds.length}`);

  // 3) Mapel uji (tanpa ujian tersisa)
  const auditMapels = await prisma.mapel.findMany({ where: { name: { startsWith: 'Audit' }, exams: { none: {} } } });
  console.log(`Mapel uji (kosong):    ${auditMapels.length}`);

  // 4) Kelas uji tanpa penghuni
  const tmpKelas = await prisma.kelas.findMany({
    where: {
      AND: [
        { name: { notIn: [...SEED_KELAS] } },
        { OR: [{ name: { startsWith: 'AUDIT-TMP' } }, { name: { equals: 'Bad TA' } }, { name: { startsWith: 'Kelas CSV' } }] },
        { users: { none: {} } },
        { sessionLinks: { none: {} } },
      ],
    },
  });
  console.log(`Kelas uji kosong:      ${tmpKelas.length}`);

  // 5) Kemungkinan data uji buatan guru seed.
  const suspicious = await prisma.examSession.findMany({
    where: { title: { startsWith: 'Sesi ' } },
    select: { title: true },
    orderBy: { updatedAt: 'desc' },
    take: 400,
  });
  const machineish = suspicious.filter((s) => /^Sesi\s+([a-z0-9]{5,}|\w+-[a-z0-9]+)(\s|$)/i.test(s.title ?? ''));
  console.log(AGGRESSIVE
    ? `\nSesi judul mesin: ${machineish.length} (akan dihapus oleh --aggressive)`
    : `\nSesi judul mesin (laporan saja, tidak dihapus tanpa --aggressive): ${machineish.length} contoh`);
  for (const s of machineish.slice(0, 8)) console.log(`  ? ${s.title}`);

  if (!APPLY) {
    console.log('\nDRY-RUN — tidak ada yang dihapus.');
    console.log('  --apply            : hapus data uji teridentifikasi (di atas)');
    console.log('  --apply --aggressive: + sesi berjudul "Sesi*"/"Audit*" dan ujian berjudul "Ujian*"/"Uji *"/"Audit*"');
    console.log('  ("uts"/"UTS" selalu dipertahankan; soal yatim dilaporkan, tidak dihapus)');
    return;
  }

  // Eksekusi (urutan aman: anak dulu, induk kemudian)
  const delSessions = await prisma.examSession.deleteMany({ where: { id: { in: sessionIds } } });
  const delAttemptsNote = 'attempt ikut terhapus via cascade sesi/user';
  const delExamQ = await prisma.examQuestion.deleteMany({ where: { examId: { in: examIds } } });
  const delExams = await prisma.exam.deleteMany({ where: { id: { in: examIds } } });
  const delExamQ2 = await prisma.examQuestion.deleteMany({ where: { questionId: { in: qIds } } });
  const delQuestions = await prisma.question.deleteMany({ where: { id: { in: qIds } } });
  const delMapels = await prisma.mapel.deleteMany({ where: { id: { in: auditMapels.map((m) => m.id) } } });
  const delKelas = await prisma.kelas.deleteMany({ where: { id: { in: tmpKelas.map((k) => k.id) } } });
  // User terakhir — sebagian mungkin menolak terhapus bila masih mereferensikan
  // sesuatu (mis. TokenAudit.releasedBy). Itu dilaporkan, tidak dipaksa.
  let deletedUsers = 0;
  const skipped = [];
  for (const u of candidates) {
    try {
      await prisma.user.delete({ where: { id: u.id } });
      deletedUsers += 1;
    } catch (e) {
      skipped.push(`${u.username}: ${(e.message || '').split('\n')[0].slice(0, 90)}`);
    }
  }

  if (AGGRESSIVE) {
    // Sesi & ujian buatan suite (judul mesin). 'uts'/'UTS' dipertahankan.
    const delSess = await prisma.examSession.deleteMany({
      where: {
        OR: [
          { title: { startsWith: 'Sesi ' } },
          { title: { startsWith: 'Audit Role Session' } },
          { title: { startsWith: 'Audit SEB Session' } },
        ],
      },
    });
    const delEx = await prisma.exam.deleteMany({
      where: {
        OR: [
          { title: { startsWith: 'Ujian' } },
          { title: { startsWith: 'Uji ' } },
          { title: { startsWith: 'Audit' } },
        ],
      },
    });
    console.log(`\n[aggressive] sesi dihapus : ${delSess.count}`);
    console.log(`[aggressive] ujian dihapus: ${delEx.count}`);
  }

  const after = await stats();
  const orphanQ = await prisma.question.count({ where: { examLinks: { none: {} } } });
  console.log(`\nSoal yatim (tidak dipakai ujian, tidak dihapus): ${orphanQ}`);
  console.log('\nDihapus:');
  console.log(`  sesi        : ${delSessions.count} (${delAttemptsNote})`);
  console.log(`  examQuestion: ${delExamQ.count + delExamQ2.count}`);
  console.log(`  ujian       : ${delExams.count}`);
  console.log(`  soal        : ${delQuestions.count}`);
  console.log(`  mapel       : ${delMapels.count}`);
  console.log(`  kelas       : ${delKelas.count}`);
  console.log(`  users       : ${deletedUsers}`);
  if (skipped.length) {
    console.log(`  dilewati    : ${skipped.length} (masih direferensikan)`);
    for (const s of skipped.slice(0, 10)) console.log(`   - ${s}`);
  }
  console.log('\nSesudah:', JSON.stringify(after));
}

main()
  .catch((e) => {
    console.error('FATAL', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
