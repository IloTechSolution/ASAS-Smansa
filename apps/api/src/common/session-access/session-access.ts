import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { tenantWhere } from '../tenant/tenant';

/**
 * Otorisasi "pengelola pelaksanaan ujian" (guru pemilik, guru untuk ujian
 * buatan ADMIN yang dibagikan, dan proktor/admin yang berjalan bebas).
 * Dipakai semua endpoint pelaksanaan (token, absensi, monitoring, kartu, dll).
 * Selalu ter-scope sekolah pemanggil.
 */
export async function assertExamManager(
  prisma: PrismaService,
  sessionId: string,
  actorId: string,
  actorRole: string,
) {
  const s = await prisma.examSession.findFirst({
    where: { id: sessionId, ...tenantWhere() },
    select: {
      id: true,
      examId: true,
      exam: { select: { createdById: true, createdBy: { select: { role: true } } } },
    },
  });
  if (!s) throw new NotFoundException('Sesi tidak ditemukan');
  if (actorRole === 'ADMIN' || actorRole === 'PROKTOR') return s;
  if (s.exam.createdById === actorId) return s;
  if (actorRole === 'GURU' && s.exam.createdBy?.role === 'ADMIN') return s;
  throw new ForbiddenException('Anda bukan pemilik ujian/sesi ini');
}

/** Sama, berdasarkan attempt (dipakai kendali proktor per peserta). */
export async function assertExamManagerByAttempt(
  prisma: PrismaService,
  attemptId: string,
  actorId: string,
  actorRole: string,
) {
  const a = await prisma.attempt.findFirst({
    where: { id: attemptId, ...tenantWhere() },
    select: {
      session: {
        select: {
          id: true,
          examId: true,
          exam: { select: { createdById: true, createdBy: { select: { role: true } } } },
        },
      },
    },
  });
  if (!a) throw new NotFoundException('Attempt tidak ditemukan');
  return assertExamManager(prisma, a.session.id, actorId, actorRole);
}
