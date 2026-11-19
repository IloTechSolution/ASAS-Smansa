import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MapelCreateInput, MapelUpdateInput } from '@cbt/shared';
import { AppConfigService } from '../common/config/app-config.service';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { requireSchoolId, tenantWhere } from '../common/tenant/tenant';

@Injectable()
export class MapelService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AppConfigService) private readonly appConfig: AppConfigService,
  ) {}

  list() {
    return this.prisma.mapel.findMany({
      where: tenantWhere(),
      include: { _count: { select: { exams: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: MapelCreateInput, actorId: string) {
    const schoolId = requireSchoolId();
    try {
      // KKM awal mengikuti konfigurasi sekolah; guru mata pelajaran bisa mengubahnya nanti.
      const kkm = await this.appConfig.getFloat('KKM_DEFAULT', 75, schoolId);
      const mapel = await this.prisma.mapel.create({
        data: { name: dto.name, code: dto.code || null, kkm, schoolId },
      });
      await this.audit.log({ actorId, action: 'MAPEL_CREATE', entity: 'Mapel', entityId: mapel.id, schoolId, meta: { name: mapel.name } });
      return mapel;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Nama/kode mapel sudah dipakai di sekolah ini');
      }
      throw e;
    }
  }

  async update(id: string, dto: MapelUpdateInput, actorId: string) {
    const existing = await this.prisma.mapel.findFirst({ where: { id, ...tenantWhere() } });
    if (!existing) throw new NotFoundException('Mapel tidak ditemukan');
    try {
      const mapel = await this.prisma.mapel.update({
        where: { id },
        data: { name: dto.name ?? undefined, code: dto.code !== undefined ? dto.code || null : undefined },
      });
      await this.audit.log({ actorId, action: 'MAPEL_UPDATE', entity: 'Mapel', entityId: id, schoolId: existing.schoolId, meta: { changes: dto } });
      return mapel;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Nama/kode mapel sudah dipakai di sekolah ini');
      }
      throw e;
    }
  }

  /** KKM diatur guru mata pelajaran (atau admin) — bukan bagian dari CRUD umum. */
  async setKkm(id: string, kkm: number, actorId: string) {
    const existing = await this.prisma.mapel.findFirst({ where: { id, ...tenantWhere() } });
    if (!existing) throw new NotFoundException('Mapel tidak ditemukan');
    const mapel = await this.prisma.mapel.update({ where: { id }, data: { kkm } });
    await this.audit.log({ actorId, action: 'MAPEL_KKM', entity: 'Mapel', entityId: id, schoolId: existing.schoolId, meta: { kkm, before: existing.kkm } });
    return mapel;
  }

  async remove(id: string, actorId: string) {
    const existing = await this.prisma.mapel.findFirst({
      where: { id, ...tenantWhere() },
      include: { _count: { select: { exams: true } } },
    });
    if (!existing) throw new NotFoundException('Mapel tidak ditemukan');
    if (existing._count.exams > 0) {
      throw new ConflictException(`Mapel dipakai ${existing._count.exams} ujian — tidak bisa dihapus`);
    }
    await this.prisma.mapel.delete({ where: { id } });
    await this.audit.log({ actorId, action: 'MAPEL_DELETE', entity: 'Mapel', entityId: id, schoolId: existing.schoolId, meta: { name: existing.name } });
    return { ok: true };
  }
}
