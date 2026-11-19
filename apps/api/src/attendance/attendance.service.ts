import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceSetInput } from '@cbt/shared';

/** Status selain sentinel "BELUM" (baris dihapus). */
type AttendanceStatusValue = 'HADIR' | 'TERLAMBAT' | 'IZIN' | 'SAKIT' | 'ALPA';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { assertExamManager } from '../common/session-access/session-access';
import { tenantWhere } from '../common/tenant/tenant';

/** Absensi digital per sesi — PROKTOR & ADMIN. */
@Injectable()
export class AttendanceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async sessionOrThrow(id: string) {
    const s = await this.prisma.examSession.findFirst({
      where: { id, ...tenantWhere() },
      include: { kelasLinks: { select: { kelasId: true } } },
    });
    if (!s) throw new NotFoundException('Sesi tidak ditemukan');
    return s;
  }

  /**
   * Peserta = siswa kelas peserta sesi; bila ujian punya enrol eksplisit,
   * hanya siswa yang terdaftar (yang lain tidak ditampilkan/absen).
   */
  async participants(sessionId: string) {
    const s = await this.sessionOrThrow(sessionId);
    const enrolled = await this.prisma.examEnrollment.findMany({
      where: { examId: s.examId, ...tenantWhere() },
      select: { userId: true },
    });
    // Enrol = pembatasan atas kelas peserta sesi (bukan perluasan lintas kelas).
    const where: Record<string, unknown> = {
      role: 'SISWA',
      isActive: true,
      kelasId: { in: s.kelasLinks.map((k) => k.kelasId) },
      ...tenantWhere(),
    };
    if (enrolled.length > 0) {
      where.id = { in: enrolled.map((e) => e.userId) };
    }
    return this.prisma.user.findMany({
      where,
      select: { id: true, username: true, name: true, nisn: true, kelas: { select: { id: true, name: true } } },
      orderBy: [{ kelas: { name: 'asc' } }, { name: 'asc' }],
    });
  }

  async list(sessionId: string, actorId?: string, actorRole?: string) {
    if (actorId) await assertExamManager(this.prisma, sessionId, actorId, actorRole ?? 'PROKTOR');
    const [users, records] = await Promise.all([
      this.participants(sessionId),
      this.prisma.attendance.findMany({
        where: { sessionId, ...tenantWhere() },
        include: { checkedInBy: { select: { id: true, name: true } } },
      }),
    ]);
    const byUser = new Map(records.map((r) => [r.userId, r]));
    const summary: Record<string, number> = { total: users.length, recorded: records.length };
    for (const r of records) summary[r.status] = (summary[r.status] ?? 0) + 1;
    return {
      sessionId,
      summary,
      data: users.map((u) => ({ user: u, attendance: byUser.get(u.id) ?? null })),
    };
  }

  async set(sessionId: string, dto: AttendanceSetInput, actorId: string, actorRole?: string) {
    if (actorRole) await assertExamManager(this.prisma, sessionId, actorId, actorRole);
    const s = await this.sessionOrThrow(sessionId);
    const users = await this.participants(sessionId);
    const allowed = new Set(users.map((u) => u.id));
    for (const it of dto.items) {
      if (!allowed.has(it.userId)) {
        throw new BadRequestException('Peserta tidak terdaftar di sesi ini');
      }
    }
    const now = new Date();
    const toClear = dto.items.filter((it) => it.status === 'BELUM');
    const toSet = dto.items.filter((it) => it.status !== 'BELUM');
    await this.prisma.$transaction([
      ...(toClear.length > 0
        ? [
            // Kosongkan absensi peserta (baris dihapus) — perbaikan salah tanda.
            this.prisma.attendance.deleteMany({
              where: { sessionId, userId: { in: toClear.map((it) => it.userId) } },
            }),
          ]
        : []),
      ...toSet.map((it) =>
        this.prisma.attendance.upsert({
          where: { sessionId_userId: { sessionId, userId: it.userId } },
          update: {
            status: it.status as AttendanceStatusValue,
            ...(it.note !== undefined ? { note: it.note } : {}),
            checkedInAt: now,
            checkedInById: actorId,
          },
          create: { sessionId, userId: it.userId, status: it.status as AttendanceStatusValue, note: it.note ?? null, checkedInAt: now, checkedInById: actorId, schoolId: s.schoolId },
        }),
      ),
    ]);
    await this.audit.log({ actorId, action: 'ATTENDANCE_SET', entity: 'ExamSession', entityId: sessionId, schoolId: s.schoolId, meta: { set: toSet.length, cleared: toClear.length } });
    return this.list(sessionId);
  }
}
