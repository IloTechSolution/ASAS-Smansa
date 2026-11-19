import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogQuery } from '@cbt/shared';
import { PrismaService } from '../prisma/prisma.service';
import { tenantStorage } from '../tenant/tenant';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  meta?: Record<string, unknown> | null;
  /** Sekolah terkait aksi; default: sekolah dari konteks tenant (null = sistem/agregat). */
  schoolId?: string | null;
}

/** Pencatat jejak audit. Panggil dari service setiap aksi tulis data penting. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      const ctx = tenantStorage.get();
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId ?? null,
          action: entry.action,
          entity: entry.entity ?? null,
          entityId: entry.entityId ?? null,
          meta: entry.meta ? (entry.meta as Prisma.InputJsonValue) : undefined,
          schoolId: entry.schoolId ?? ctx?.schoolId ?? null,
        },
      });
    } catch (e) {
      // Audit tidak boleh menggagalkan aksi utama — tapi jangan hilang tanpa jejak.
      this.logger.warn(`Gagal menulis audit log [${entry.action} ${entry.entity ?? ''}:${entry.entityId ?? ''}]: ${(e as Error).message}`);
    }
  }

  /** Baca jejak audit (admin) dengan paginasi + filter, ter-scope sekolah. */
  async list(q: AuditLogQuery) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const ctx = tenantStorage.get();
    const where: Prisma.AuditLogWhereInput = {};
    if (ctx?.schoolId) where.schoolId = ctx.schoolId;
    if (q.action) where.action = { contains: q.action, mode: 'insensitive' };
    if (q.entity) where.entity = { contains: q.entity, mode: 'insensitive' };
    if (q.actorId) where.actorId = q.actorId;
    const [total, data] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, username: true, name: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { data, total, page, limit };
  }
}
