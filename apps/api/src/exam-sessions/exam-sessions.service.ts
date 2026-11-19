import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SessionCreateInput, SessionKelasSetInput, SessionListQuery, SessionStatusInput, SessionUpdateInput, SessionVisibilityInput } from '@cbt/shared';
import { randomBytes } from 'crypto';
import { AppConfigService } from '../common/config/app-config.service';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { GradingService } from '../grading/grading.service';
import { MonitoringGateway } from '../monitoring/monitoring.gateway';
import { RedisService } from '../common/redis/redis.service';
import { tenantWhere } from '../common/tenant/tenant';

/**
 * Secret TOTP tidak pernah keluar API — bahan bakar seluruh token ujian.
 * Tiap sesi yang diserialisasi ke klien wajib lewat fungsi ini.
 */
function toPublicSession<T extends { tokenSecret?: string | null }>(s: T): Omit<T, 'tokenSecret'> {
  const { tokenSecret: _tokenSecret, ...rest } = s;
  return rest;
}

/** Sesi ujian. Kepemilikan mengikuti ujian induk (guru) / bebas (admin). */
@Injectable()
export class ExamSessionsService {
  private readonly logger = new Logger(ExamSessionsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AppConfigService) private readonly appConfig: AppConfigService,
    @Inject(GradingService) private readonly grading: GradingService,
    @Inject(MonitoringGateway) private readonly gateway: MonitoringGateway,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  private async owned(id: string, actorId: string, actorRole: string) {
    const s = await this.prisma.examSession.findFirst({
      where: { id, ...tenantWhere() },
      include: {
        exam: { select: { id: true, title: true, createdById: true, createdBy: { select: { role: true } }, mapel: { select: { name: true } } } },
        kelasLinks: { include: { kelas: { select: { id: true, name: true } } } },
        _count: { select: { attempts: true, attendances: true, tokenAudits: true } },
      },
    });
    const isAdminExam = s?.exam.createdBy?.role === 'ADMIN';
    // PROKTOR boleh mengelola pelaksanaan (jadwal/kelas/status) sesi mana pun.
    const allowed =
      actorRole === 'ADMIN' ||
      actorRole === 'PROKTOR' ||
      s?.exam.createdById === actorId ||
      (actorRole === 'GURU' && isAdminExam);
    if (!s || !allowed) {
      throw new NotFoundException('Sesi tidak ditemukan');
    }
    return s;
  }

  private async ownedExam(examId: string, actorId: string, actorRole: string) {
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, ...tenantWhere() },
      include: { createdBy: { select: { role: true } }, _count: { select: { questions: true } } },
    });
    const isAdminExam = exam?.createdBy?.role === 'ADMIN';
    // Guru boleh membuat sesi untuk ujiannya sendiri atau ujian buatan ADMIN.
    if (!exam || (actorRole !== 'ADMIN' && exam.createdById !== actorId && !(actorRole === 'GURU' && isAdminExam))) {
      throw new NotFoundException('Ujian tidak ditemukan');
    }
    return exam;
  }

  async list(q: SessionListQuery, actorId: string, actorRole: string) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    // Skop peran digabung dengan skop sekolah supaya tidak tumpang tindih/melebar.
    const scope: Prisma.ExamSessionWhereInput = (() => {
      if (actorRole === 'ADMIN' || actorRole === 'PROKTOR') {
        return q.mine ? { exam: { createdById: actorId } } : {};
      }
      if (actorRole === 'GURU' && !q.mine) {
        // Guru melihat sesi sendiri + sesi atas ujian buatan ADMIN (dibagikan di sekolahnya).
        return { OR: [{ exam: { createdById: actorId } }, { exam: { createdBy: { role: 'ADMIN' } } }] };
      }
      return { exam: { createdById: actorId } };
    })();
    const where: Prisma.ExamSessionWhereInput = {
      AND: [
        scope,
        tenantWhere(),
        ...(q.examId ? [{ examId: q.examId }] : []),
        ...(q.visible !== undefined ? [{ visibleToSiswa: q.visible }] : []),
        ...(q.hari ? [{ hariPelaksanaan: q.hari }] : []),
        ...(q.status ? [{ status: q.status }] : []),
        ...(q.search?.trim()
          ? [{
              OR: [
                { title: { contains: q.search.trim(), mode: 'insensitive' as const } },
                { exam: { title: { contains: q.search.trim(), mode: 'insensitive' as const } } },
              ],
            }]
          : []),
      ],
    };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.examSession.count({ where }),
      this.prisma.examSession.findMany({
        where,
        include: {
          exam: { select: { id: true, title: true, mapel: { select: { name: true } } } },
          kelasLinks: { include: { kelas: { select: { id: true, name: true } } } },
          _count: { select: { attempts: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { data: data.map(toPublicSession), total, page, limit };
  }

  async detail(id: string, actorId: string, actorRole: string) {
    const s = await this.owned(id, actorId, actorRole);
    const qCount = await this.prisma.examQuestion.count({ where: { examId: s.examId } });
    const agg = await this.prisma.examQuestion.findMany({
      where: { examId: s.examId },
      include: { question: { select: { weight: true } } },
    });
    return { ...toPublicSession(s), questionCount: qCount, totalWeight: agg.reduce((x, l) => x + l.question.weight, 0) };
  }

  private async assertKelasExist(kelasIds: string[], schoolId: string) {
    if (kelasIds.length === 0) return;
    const found = await this.prisma.kelas.count({ where: { id: { in: kelasIds }, schoolId } });
    if (found !== new Set(kelasIds).size) {
      throw new BadRequestException('Sebagian kelas tidak ditemukan di sekolah ini');
    }
  }

  async create(dto: SessionCreateInput, actorId: string, actorRole: string) {
    const exam = await this.ownedExam(dto.examId, actorId, actorRole);
    const schoolId = exam.schoolId;
    // Dedupe dulu seperti setKelas — duplikat mentah memicu P2002 (500).
    const kelasIds = [...new Set(dto.kelasIds)];
    await this.assertKelasExist(kelasIds, schoolId);
    // Default aturan mengikuti konfigurasi sekolah bila tidak diisi eksplisit.
    const tokenIntervalSec = dto.tokenIntervalSec ?? (await this.appConfig.getInt('TOKEN_DEFAULT_INTERVAL_SEC', 120, schoolId));
    const maxViolations = dto.maxViolations ?? (await this.appConfig.getInt('MAX_VIOLATIONS_DEFAULT', 3, schoolId));
    const requireSeb = dto.requireSeb ?? (await this.appConfig.getBool('REQUIRE_SEB_DEFAULT', false, schoolId));
    // tokenSecret dibuat server — bahan token rotating TOTP (Fase 4).
    const tokenSecret = randomBytes(20).toString('base64url');
    // Hari pelaksanaan menggantikan jadwal tanggal+jam (opsional selama masa transisi).
    const s = await this.prisma.examSession.create({
      data: {
        examId: dto.examId,
        title: dto.title ?? null,
        hariPelaksanaan: dto.hariPelaksanaan ?? null,
        startsAt: dto.startsAt ?? null,
        endsAt: dto.endsAt ?? null,
        durationMin: dto.durationMin,
        tokenSecret,
        tokenIntervalSec,
        maxViolations,
        requireSeb,
        shuffleQuestions: dto.shuffleQuestions ?? true,
        shuffleOptions: dto.shuffleOptions ?? true,
        schoolId,
        kelasLinks: { create: kelasIds.map((kelasId) => ({ kelasId })) },
      },
    });
    await this.audit.log({ actorId, action: 'SESSION_CREATE', entity: 'ExamSession', entityId: s.id, schoolId, meta: { examId: dto.examId } });
    return toPublicSession(s);
  }

  async update(id: string, dto: SessionUpdateInput, actorId: string, actorRole: string) {
    const s = await this.owned(id, actorId, actorRole);
    if (s.visibleToSiswa || s.status === 'CLOSED') {
      // Saat tampil hanya interval token yang boleh diubah (rotasi token saat ujian).
      const changed = Object.keys(dto).filter((k) => dto[k as keyof typeof dto] !== undefined);
      const allowed = new Set(['tokenIntervalSec']);
      const forbidden = changed.filter((k) => !allowed.has(k));
      if (forbidden.length) {
        throw new ConflictException('Sesi tampil ke siswa — hanya interval token yang boleh diubah; sembunyikan dulu untuk mengedit pengaturan lain');
      }
    }
    const startsAt = dto.startsAt !== undefined ? dto.startsAt : s.startsAt;
    const endsAt = dto.endsAt !== undefined ? dto.endsAt : s.endsAt;
    if (startsAt && endsAt && startsAt >= endsAt) {
      throw new BadRequestException('Waktu selesai harus setelah mulai');
    }
    const updated = await this.prisma.examSession.update({ where: { id }, data: { ...dto } });
    await this.audit.log({ actorId, action: 'SESSION_UPDATE', entity: 'ExamSession', entityId: id, schoolId: s.schoolId, meta: { changes: dto } });
    return toPublicSession(updated);
  }
  async setKelas(id: string, dto: SessionKelasSetInput, actorId: string, actorRole: string) {
    const s = await this.owned(id, actorId, actorRole);
    if (s.visibleToSiswa || s.status === 'CLOSED') {
      throw new ConflictException('Kelas peserta sesi yang tampil / sudah ditutup tidak bisa diubah — sembunyikan dulu untuk mengedit');
    }
    await this.assertKelasExist(dto.kelasIds, s.schoolId);
    await this.prisma.$transaction([
      this.prisma.sessionKelas.deleteMany({ where: { sessionId: id } }),
      this.prisma.sessionKelas.createMany({ data: [...new Set(dto.kelasIds)].map((kelasId) => ({ sessionId: id, kelasId })) }),
    ]);
    await this.audit.log({ actorId, action: 'SESSION_SET_KELAS', entity: 'ExamSession', entityId: id, schoolId: s.schoolId, meta: { count: dto.kelasIds.length } });
    return this.detail(id, actorId, actorRole);
  }

  /** Prasyarat minimal sebelum sesi bisa ditampilkan ke siswa. */
  private async assertReadyToPublish(s: { examId: string; kelasLinks: unknown[] }) {
    if (s.kelasLinks.length === 0) {
      throw new ConflictException('Minimal 1 kelas peserta wajib dipilih');
    }
    const qCount = await this.prisma.examQuestion.count({ where: { examId: s.examId } });
    if (qCount === 0) {
      throw new ConflictException('Ujian belum punya soal — susun dulu di builder');
    }
  }

  /**
   * Tampilkan / sembunyikan ujian ke siswa — satu-satunya saklar pelaksanaan
   * (menggantikan alur DRAFT→SCHEDULED→ACTIVE→CLOSED). Tampil → status='ACTIVE';
   * sembunyi → status='DRAFT'. Menutup paksa tetap ada lewat POST .../close.
   */
  async setVisibility(id: string, dto: SessionVisibilityInput, actorId: string, actorRole: string) {
    const s = await this.owned(id, actorId, actorRole);
    if (dto.visible) {
      if (s.status === 'CLOSED') {
        throw new ConflictException('Sesi sudah ditutup — buat sesi baru atau gunakan remedial');
      }
      await this.assertReadyToPublish(s);
      await this.prisma.examSession.update({ where: { id }, data: { visibleToSiswa: true, status: 'ACTIVE' } });
      await this.audit.log({ actorId, action: 'SESSION_VISIBILITY', entity: 'ExamSession', entityId: id, schoolId: s.schoolId, meta: { visible: true } });
      return { ok: true as const, visibleToSiswa: true };
    }
    await this.prisma.examSession.update({
      where: { id },
      data: { visibleToSiswa: false, status: s.status === 'CLOSED' ? 'CLOSED' : 'DRAFT' },
    });
    await this.audit.log({ actorId, action: 'SESSION_VISIBILITY', entity: 'ExamSession', entityId: id, schoolId: s.schoolId, meta: { visible: false } });
    return { ok: true as const, visibleToSiswa: false };
  }

  /** Tutup & kumpul paksa semua attempt yang masih berjalan (tombol darurat). */
  async closeForcibly(id: string, actorId: string, actorRole: string) {
    const s = await this.owned(id, actorId, actorRole);
    const updated = await this.prisma.examSession.update({
      where: { id },
      data: { visibleToSiswa: false, status: 'CLOSED' },
    });
    const forceClosed = await this.forceCloseRunning(id, actorId, s.schoolId);
    await this.audit.log({ actorId, action: 'SESSION_CLOSE', entity: 'ExamSession', entityId: id, schoolId: s.schoolId, meta: { forceClosed } });
    return { ...toPublicSession(updated), forceClosed };
  }

  /** Kompatibilitas: /status lama dipetakan ke model visibilitas. */
  async setStatus(id: string, dto: SessionStatusInput, actorId: string, actorRole: string) {
    const to = dto.status;
    if (to === 'ACTIVE') return this.setVisibility(id, { visible: true }, actorId, actorRole);
    if (to === 'DRAFT' || to === 'SCHEDULED') return this.setVisibility(id, { visible: false }, actorId, actorRole);
    // CLOSED
    return this.closeForcibly(id, actorId, actorRole);
  }

  /** Kumpulkan paksa semua IN_PROGRESS di sesi ini; nilai otomatis dihitung ulang. */
  private async forceCloseRunning(sessionId: string, actorId: string, schoolId: string): Promise<number> {
    const running = await this.prisma.attempt.findMany({
      where: { sessionId, status: 'IN_PROGRESS' },
      select: { id: true, expiresAt: true },
    });
    if (running.length === 0) return 0;
    const now = new Date();
    // Yang waktunya sudah habis ditandai EXPIRED (konsisten dengan auto-expire);
    // sisanya benar-benar masih berjalan → dikumpulkan paksa.
    const expiredIds = running.filter((a) => a.expiresAt.getTime() <= now.getTime()).map((a) => a.id);
    const forcedIds = running.filter((a) => a.expiresAt.getTime() > now.getTime()).map((a) => a.id);
    // Balapan dengan submit/auto-expire — hanya yang masih IN_PROGRESS yang flip.
    if (expiredIds.length) {
      await this.prisma.attempt.updateMany({
        where: { id: { in: expiredIds }, status: 'IN_PROGRESS' },
        data: { status: 'EXPIRED', submittedAt: now },
      });
    }
    if (forcedIds.length) {
      await this.prisma.attempt.updateMany({
        where: { id: { in: forcedIds }, status: 'IN_PROGRESS' },
        data: { status: 'FORCE_SUBMITTED', submittedAt: now },
      });
    }
    for (const a of running) {
      // Siswa menerima sinyal yang sama seperti force-submit proktor.
      this.gateway.sendControl({
        type: 'force-submit',
        attemptId: a.id,
        submittedAt: now.toISOString(),
        reason: 'Sesi ujian ditutup',
      });
      try {
        await this.grading.gradeAttempt(a.id);
      } catch (e) {
        this.logger.warn(`Penilaian attempt ${a.id} saat tutup sesi gagal: ${(e as Error).message}`);
      }
    }
    await this.audit.log({
      actorId,
      action: 'SESSION_CLOSE_FORCE_SUBMIT',
      entity: 'ExamSession',
      entityId: sessionId,
      schoolId,
      meta: { forced: forcedIds.length, expired: expiredIds.length },
    });
    return running.length;
  }

  async remove(id: string, actorId: string, actorRole: string) {
    const s = await this.owned(id, actorId, actorRole);
    // Hapus hanya pemilik ujian atau admin — proktor/guru lain tidak boleh.
    if (actorRole !== 'ADMIN' && s.exam.createdById !== actorId) {
      throw new ForbiddenException('Hanya pemilik ujian atau admin yang boleh menghapus sesi');
    }
    const used = s._count.attempts + s._count.attendances + s._count.tokenAudits;
    // Non-admin tetap dilindungi (harus 409). ADMIN boleh menghapus sesi yang
    // sudah terlaksana — semua turunan ikut terhapus via cascade DB (Attempt→
    // AttemptAnswer/IntegrityLog, Attendance, TokenAudit, SessionKelas).
    if (actorRole !== 'ADMIN' && used > 0) {
      throw new ConflictException(
        `Sesi punya data turunan (${s._count.attempts} attempt, ${s._count.attendances} absensi, ${s._count.tokenAudits} rilis token) — hanya admin yang bisa menghapus`,
      );
    }
    // Kumpulkan id attempt sebelum hapus (untuk purge Redis best-effort).
    const attempts = used > 0
      ? await this.prisma.attempt.findMany({ where: { sessionId: id }, select: { id: true } })
      : [];
    await this.prisma.examSession.delete({ where: { id } });
    // Bersihkan cermin Redis (hash jawaban + heartbeat) — DB tetap sumber kebenaran.
    if (attempts.length) {
      for (const a of attempts) {
        try {
          await this.redis.del(`attempt:${a.id}:answer`);
          await this.redis.del(`attempt:${a.id}:hb`);
        } catch (e) {
          this.logger.warn(`Gagal purge Redis attempt ${a.id} saat hapus sesi: ${(e as Error).message}`);
        }
      }
    }
    await this.audit.log({
      actorId,
      action: used > 0 ? 'SESSION_DELETE_FORCE' : 'SESSION_DELETE',
      entity: 'ExamSession',
      entityId: id,
      schoolId: s.schoolId,
      meta: { attempts: s._count.attempts, attendances: s._count.attendances, tokenAudits: s._count.tokenAudits },
    });
    return {
      ok: true as const,
      deleted: {
        attempts: s._count.attempts,
        attendances: s._count.attendances,
        tokenAudits: s._count.tokenAudits,
      },
    };
  }
}
