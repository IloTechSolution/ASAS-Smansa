import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { tenantWhere } from '../common/tenant/tenant';

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class AnalyticsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Guru hanya boleh membuka analitik ujian miliknya (+ ujian buatan ADMIN
   * yang dibagikan); admin semua. Proktor tidak boleh (mengawasi pelaksanaan
   * tanpa melihat nilai — keputusan sekolah, 11 Nov 2026).
   */
  private async owned(examId: string, actorId: string, actorRole: string) {
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, ...tenantWhere() },
      select: { id: true, createdById: true, createdBy: { select: { role: true } } },
    });
    if (!exam) throw new NotFoundException('Ujian tidak ditemukan');
    const isAdminExam = exam.createdBy?.role === 'ADMIN';
    if (
      actorRole !== 'ADMIN' &&
      exam.createdById !== actorId &&
      !(actorRole === 'GURU' && isAdminExam)
    ) {
      throw new ForbiddenException('Anda bukan pemilik ujian ini');
    }
    return exam;
  }

  async examStats(examId: string, actorId: string, actorRole: string) {
    await this.owned(examId, actorId, actorRole);

    const [attempts, links] = await Promise.all([
      this.prisma.attempt.findMany({
        where: { session: { examId }, ...tenantWhere() },
        select: { score: true, status: true, violationCount: true, startedAt: true, submittedAt: true },
      }),
      this.prisma.examQuestion.findMany({
        where: { examId, ...tenantWhere() },
        include: { question: { select: { weight: true } } },
      }),
    ]);

    const maxScore = round2(links.reduce((sum, l) => sum + (Number(l.question.weight) || 0), 0));
    // Hanya attempt yang sudah dinilai (bukan yang masih dikerjakan) masuk rata-rata.
    const scores = attempts
      .filter((a) => a.status !== 'IN_PROGRESS')
      .map((a) => a.score)
      .filter((s): s is number => s !== null);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const submitted = attempts.filter((a) => a.status === 'SUBMITTED').length;
    const violations = attempts.reduce((s, a) => s + (a.violationCount || 0), 0);

    return {
      examId,
      totalAttempt: attempts.length,
      finished: attempts.filter((a) => a.status !== 'IN_PROGRESS').length,
      submitted,
      avgScore: round2(avg),
      maxScore,
      avgPercent: maxScore > 0 ? round2((avg / maxScore) * 100) : 0,
      highest: scores.length ? round2(Math.max(...scores)) : 0,
      lowest: scores.length ? round2(Math.min(...scores)) : 0,
      totalViolations: violations,
    };
  }
}
