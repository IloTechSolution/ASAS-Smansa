import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MonitorExtendInput, MonitorWarnInput } from '@cbt/shared';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { GradingService } from '../grading/grading.service';
import { MonitoringGateway } from './monitoring.gateway';
import { assertExamManager, assertExamManagerByAttempt } from '../common/session-access/session-access';
import { tenantWhere } from '../common/tenant/tenant';

/** Papan monitoring + kendali attempt (Fase 6). */
@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MonitoringGateway) private readonly gateway: MonitoringGateway,
    @Inject(GradingService) private readonly grading: GradingService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  private async attemptOrThrow(attemptId: string) {
    const a = await this.prisma.attempt.findFirst({
      where: { id: attemptId, ...tenantWhere() },
      include: { session: { select: { id: true, examId: true, durationMin: true, status: true, endsAt: true } } },
    });
    if (!a) throw new NotFoundException('Attempt tidak ditemukan');
    return a;
  }

  /** Snapshot live satu sesi: status peserta, progres, pelanggaran, online terakhir. */
  async assertBoardAccess(sessionId: string, actorId: string, actorRole: string) {
    await assertExamManager(this.prisma, sessionId, actorId, actorRole);
  }

  async board(sessionId: string, actorId?: string, actorRole?: string) {
    if (actorId) await assertExamManager(this.prisma, sessionId, actorId, actorRole ?? 'PROKTOR');
    const session = await this.prisma.examSession.findFirst({
      where: { id: sessionId, ...tenantWhere() },
      include: {
        exam: { select: { id: true, title: true, mapel: { select: { name: true } } } },
        kelasLinks: { select: { kelasId: true } },
      },
    });
    if (!session) throw new NotFoundException('Sesi tidak ditemukan');

    const [attempts, questionCount, answerCounts] = await Promise.all([
      this.prisma.attempt.findMany({
        where: { sessionId, ...tenantWhere() },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              username: true,
              nisn: true,
              kelas: { select: { name: true } },
            },
          },
        },
        orderBy: { startedAt: 'asc' },
      }),
      this.prisma.examQuestion.count({ where: { examId: session.examId, ...tenantWhere() } }),
      this.prisma.attemptAnswer.groupBy({
        by: ['attemptId'],
        where: { attempt: { sessionId }, ...tenantWhere() },
        _count: { _all: true },
      }),
    ]);

    const answeredByAttempt = new Map(answerCounts.map((r) => [r.attemptId, r._count._all]));
    const heartbeats = await this.gateway.lastHeartbeats(attempts.map((a) => a.id));
    const now = Date.now();

    const data = attempts.map((a) => {
      const lastSeen = heartbeats.get(a.id) ?? null;
      const remainingSec = Math.max(0, Math.floor((a.expiresAt.getTime() - now) / 1000));
      return {
        attempt: {
          id: a.id,
          status: a.status,
          startedAt: a.startedAt,
          expiresAt: a.expiresAt,
          submittedAt: a.submittedAt,
          violationCount: a.violationCount,
          sebVerified: a.sebVerified,
          lockedAt: a.lockedAt ?? null,
        },
        user: a.user,
        answeredCount: answeredByAttempt.get(a.id) ?? 0,
        questionCount,
        remainingSec,
        online: a.status === 'IN_PROGRESS' && lastSeen !== null && now - lastSeen < 60_000,
        lastSeenAt: lastSeen ? new Date(lastSeen).toISOString() : null,
      };
    });

    const summary = {
      total: data.length,
      inProgress: data.filter((d) => d.attempt.status === 'IN_PROGRESS').length,
      submitted: data.filter((d) => d.attempt.status === 'SUBMITTED').length,
      expired: data.filter((d) => d.attempt.status === 'EXPIRED').length,
      forced: data.filter((d) => d.attempt.status === 'FORCE_SUBMITTED').length,
      locked: data.filter((d) => d.attempt.lockedAt !== null).length,
      online: data.filter((d) => d.online).length,
      violations: data.reduce((s, d) => s + d.attempt.violationCount, 0),
    };

    return {
      sessionId,
      session: {
        id: session.id,
        title: session.title ?? session.exam.title,
        exam: session.exam,
        status: session.status,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        durationMin: session.durationMin,
        maxViolations: session.maxViolations,
        resultsPublished: session.resultsPublished,
      },
      questionCount,
      serverTime: new Date(now).toISOString(),
      summary,
      data,
    };
  }

  /** Peringatan ke satu peserta (realtime + dicatat sebagai integritas). */
  async warn(attemptId: string, dto: MonitorWarnInput, actorId: string, actorName: string, actorRole = 'PROKTOR') {
    // GURU pemilik ujian juga boleh — bukan hanya proktor. assertExamManager
    // sudah menolak guru non-pemilik dengan 403.
    await assertExamManagerByAttempt(this.prisma, attemptId, actorId, actorRole);
    const a = await this.attemptOrThrow(attemptId);
    if (a.status !== 'IN_PROGRESS') {
      throw new ConflictException('Attempt sudah selesai — peringatan tidak dikirim');
    }
    await this.prisma.integrityLog.create({
      data: {
        attemptId,
        type: 'OTHER',
        detail: { warn: true, message: dto.message, by: actorId },
        schoolId: a.schoolId,
      },
    });
    this.gateway.sendWarn(attemptId, { message: dto.message, from: actorName });
    await this.broadcastBoard(a.sessionId);
    await this.audit.log({
      actorId,
      action: 'ATTEMPT_WARN',
      entity: 'Attempt',
      entityId: attemptId,
      schoolId: a.schoolId,
      meta: { message: dto.message },
    });
    return { ok: true as const, sentTo: a.userId, message: dto.message };
  }

  /** Perpanjang waktu pengerjaan peserta (menit) — server tetap sumber kebenaran. GURU pemilik diperbolehkan (cek di assertExamManagerByAttempt). */
  async extend(attemptId: string, dto: MonitorExtendInput, actorId: string, actorRole = 'PROKTOR') {
    // Dipakai proktor/admin/guru pemilik — bukan hanya proktor.
    void 0;
    await assertExamManagerByAttempt(this.prisma, attemptId, actorId, actorRole);
    const a = await this.attemptOrThrow(attemptId);
    if (a.status !== 'IN_PROGRESS') {
      throw new ConflictException('Attempt sudah selesai — tidak bisa diperpanjang');
    }
    const now0 = Date.now();
    if (a.expiresAt.getTime() <= now0) {
      // Sudah lewat waktu tapi belum ditandai EXPIRED — jangan hidupkan lagi.
      throw new ConflictException('Waktu peserta ini sudah habis — tidak bisa diperpanjang');
    }
    if (a.session.status === 'CLOSED') {
      throw new ConflictException('Sesi sudah ditutup — tidak bisa diperpanjang');
    }
    const now = Date.now();
    const base = Math.max(a.expiresAt.getTime(), now);
    let expiresAt = new Date(base + dto.minutes * 60_000);
    // Jangan lewati batas akhir sesi (endsAt) bila sesi punya jadwal tutup.
    if (a.session.endsAt && expiresAt.getTime() > a.session.endsAt.getTime()) {
      expiresAt = new Date(a.session.endsAt.getTime());
    }
    if (expiresAt.getTime() <= now) {
      throw new ConflictException('Batas akhir sesi sudah lewat — perpanjangan tidak berpengaruh');
    }
    const updated = await this.prisma.attempt.update({
      where: { id: attemptId },
      data: { expiresAt },
    });
    this.gateway.sendControl({
      type: 'extend',
      attemptId,
      expiresAt: expiresAt.toISOString(),
      reason: dto.note ?? undefined,
    });
    await this.broadcastBoard(a.sessionId);
    await this.audit.log({
      actorId,
      action: 'ATTEMPT_EXTEND',
      entity: 'Attempt',
      entityId: attemptId,
      schoolId: a.schoolId,
      meta: { minutes: dto.minutes, note: dto.note ?? null, to: expiresAt.toISOString() },
    });
    return { ok: true as const, attemptId, expiresAt: updated.expiresAt.toISOString() };
  }

  /** Kumpulkan paksa satu peserta — proktor/admin/guru pemilik (cek kepemilikan di assertExamManagerByAttempt). */
  async forceSubmit(attemptId: string, actorId: string, actorRole = 'PROKTOR') {
    await assertExamManagerByAttempt(this.prisma, attemptId, actorId, actorRole);
    const a = await this.attemptOrThrow(attemptId);
    if (a.status !== 'IN_PROGRESS') {
      throw new ConflictException('Attempt sudah selesai');
    }
    if (a.expiresAt.getTime() <= Date.now()) {
      // Waktu habis di server tapi belum ditandai EXPIRED — jangan klaim "dipaksa proktor".
      throw new ConflictException('Waktu peserta ini sudah habis — peserta sudah selesai otomatis');
    }
    const submittedAt = new Date();
    const flipped = await this.prisma.attempt.updateMany({
      where: { id: attemptId, status: 'IN_PROGRESS' },
      data: { status: 'FORCE_SUBMITTED', submittedAt },
    });
    if (flipped.count === 0) {
      throw new ConflictException('Attempt sudah selesai');
    }
    this.gateway.sendControl({
      type: 'force-submit',
      attemptId,
      submittedAt: submittedAt.toISOString(),
      reason: 'Dikumpulkan oleh proktor',
    });
    // Attempt selesai → nilai otomatis (Fase 7).
    try {
      await this.grading.gradeAttempt(attemptId);
    } catch (e) {
      this.logger.warn(`Penilaian attempt ${attemptId} gagal: ${(e as Error).message}`);
    }
    await this.broadcastBoard(a.sessionId);
    await this.audit.log({
      actorId,
      action: 'ATTEMPT_FORCE_SUBMIT',
      entity: 'Attempt',
      entityId: attemptId,
      schoolId: a.schoolId,
      meta: { by: 'proktor' },
    });
    return { ok: true as const, attemptId, status: 'FORCE_SUBMITTED' as const, submittedAt: submittedAt.toISOString() };
  }

  /**
   * Remedial: reset attempt satu siswa agar bisa mengerjakan ulang.
   * Kepemilikan lewat assertExamManagerByAttempt (pemilik/admin/proktor).
   * Menghapus jawaban + log integritas + Redis; siswa start ulang dgn token baru.
   * Ditolak bila hasil terbit, sesi CLOSED, atau peserta masih mengerjakan.
   */
  async resetForRemedial(
    attemptId: string,
    dto: { reason?: string | null },
    actorId: string,
    actorRole: string,
  ) {
    await assertExamManagerByAttempt(this.prisma, attemptId, actorId, actorRole);
    const a = await this.prisma.attempt.findFirst({
      where: { id: attemptId, ...tenantWhere() },
      include: {
        session: {
          select: { id: true, status: true, resultsPublished: true },
        },
      },
    });
    if (!a) throw new NotFoundException('Attempt tidak ditemukan');
    if (a.session.resultsPublished) {
      throw new ConflictException('Hasil sudah terbit — remedial tidak diizinkan. Tarik hasil kembali dulu bila perlu.');
    }
    if (a.session.status === 'CLOSED') {
      throw new ConflictException('Sesi sudah CLOSED — remedial hanya saat sesi masih berjalan/SCHEDULED. Buka sesi baru bila perlu.');
    }
    if (a.status === 'IN_PROGRESS') {
      if (a.expiresAt.getTime() > Date.now()) {
        throw new ConflictException('Peserta masih mengerjakan — gunakan force-submit dulu sebelum remedial.');
      }
      await this.prisma.attempt.updateMany({ where: { id: attemptId, status: 'IN_PROGRESS' }, data: { status: 'EXPIRED', submittedAt: a.expiresAt } });
    }
    const deletedAnswers = await this.prisma.attemptAnswer.count({ where: { attemptId } });
    const deletedLogs = await this.prisma.integrityLog.count({ where: { attemptId } });
    await this.prisma.$transaction([
      this.prisma.attemptAnswer.deleteMany({ where: { attemptId } }),
      this.prisma.integrityLog.deleteMany({ where: { attemptId } }),
      this.prisma.attempt.delete({ where: { id: attemptId } }),
    ]);
    try {
      await this.redis.del(`attempt:${attemptId}:answer`);
      await this.redis.del(`attempt:${attemptId}:hb`);
    } catch {
      // Redis opsional; DB tetap sumber kebenaran.
    }
    this.gateway.notifyActivity(a.sessionId, attemptId, 'reset');
    await this.broadcastBoard(a.sessionId);
    await this.audit.log({
      actorId,
      action: 'ATTEMPT_RESET_REMIDIAL',
      entity: 'Attempt',
      entityId: attemptId,
      schoolId: a.schoolId,
      meta: { sessionId: a.sessionId, userId: a.userId, reason: dto.reason ?? null, deletedAnswers, deletedLogs },
    });
    return { ok: true as const, attemptId, sessionId: a.sessionId, deletedAnswers, deletedLogs };
  }

  /** Pemancar ulang snapshot sesi ke papan proktor. */
  async broadcastBoard(sessionId: string) {
    try {
      const snapshot = await this.board(sessionId);
      this.gateway.broadcastSessionStatus(sessionId, snapshot);
      return snapshot;
    } catch (e) {
      // broadcast bersifat best-effort — tapi jangan sampai tak terlihat di log
      this.logger.warn(`Gagal broadcast papan sesi ${sessionId}: ${(e as Error).message}`);
      return null;
    }
  }
}
