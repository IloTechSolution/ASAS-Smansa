import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { assertExamManager } from '../common/session-access/session-access';
import { tenantWhere } from '../common/tenant/tenant';

@Injectable()
export class IntegrityService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(sessionId: string, actorId?: string, actorRole?: string) {
    if (actorId) await assertExamManager(this.prisma, sessionId, actorId, actorRole ?? 'PROKTOR');
    const logs = await this.prisma.integrityLog.findMany({
      where: { attempt: { sessionId }, ...tenantWhere() },
      include: { attempt: { include: { user: { select: { name: true, nisn: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { sessionId, count: logs.length, data: logs };
  }

  /** Monitoring pelanggaran lintas sesi (panel tersendiri di sidebar). */
  async global(sessionId?: string, limit = 50) {
    const where = {
      ...tenantWhere(),
      ...(sessionId ? { attempt: { sessionId } } : {}),
    };
    const [logs, sessions] = await Promise.all([
      this.prisma.integrityLog.findMany({
        where,
        include: {
          attempt: {
            select: {
              id: true,
              violationCount: true,
              status: true,
              user: { select: { name: true, username: true, nisn: true, kelas: { select: { name: true } } } },
              session: { select: { id: true, title: true, status: true, exam: { select: { title: true } } } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.examSession.findMany({
        where: { attempts: { some: { violationCount: { gt: 0 } } }, ...tenantWhere() },
        select: { id: true, title: true, exam: { select: { title: true } }, status: true, _count: { select: { attempts: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
    ]);
    const byType: Record<string, number> = {};
    for (const l of logs) byType[l.type] = (byType[l.type] ?? 0) + 1;
    return { count: logs.length, limit, byType, sessions, data: logs };
  }
}
