import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { KelasCreateInput, KelasUpdateInput } from '@cbt/shared';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { requireSchoolId, tenantWhere } from '../common/tenant/tenant';

@Injectable()
export class KelasService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  list(tahunAjaran?: string) {
    return this.prisma.kelas.findMany({
      where: { ...tenantWhere(), ...(tahunAjaran ? { tahunAjaran } : {}) },
      include: { _count: { select: { users: true, sessionLinks: true } } },
      orderBy: [{ tahunAjaran: 'desc' }, { name: 'asc' }],
    });
  }

  /** Daftar tahun ajaran unik (untuk filter/dropdown), terbaru dulu. */
  async tahunAjaran() {
    const rows = await this.prisma.kelas.findMany({
      where: tenantWhere(),
      distinct: ['tahunAjaran'],
      select: { tahunAjaran: true },
      orderBy: { tahunAjaran: 'desc' },
    });
    return rows.map((r) => r.tahunAjaran);
  }

  async create(dto: KelasCreateInput, actorId: string) {
    const schoolId = requireSchoolId();
    try {
      const kelas = await this.prisma.kelas.create({ data: { ...dto, ruang: dto.ruang || null, schoolId } });
      await this.audit.log({ actorId, action: 'KELAS_CREATE', entity: 'Kelas', entityId: kelas.id, schoolId, meta: { name: kelas.name } });
      return kelas;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Nama kelas sudah dipakai di sekolah ini');
      }
      throw e;
    }
  }

  async update(id: string, dto: KelasUpdateInput, actorId: string) {
    const existing = await this.prisma.kelas.findFirst({ where: { id, ...tenantWhere() } });
    if (!existing) throw new NotFoundException('Kelas tidak ditemukan');
    try {
      const kelas = await this.prisma.kelas.update({ where: { id }, data: dto });
      await this.audit.log({ actorId, action: 'KELAS_UPDATE', entity: 'Kelas', entityId: id, schoolId: existing.schoolId, meta: { changes: dto } });
      return kelas;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Nama kelas sudah dipakai di sekolah ini');
      }
      throw e;
    }
  }

  async remove(id: string, actorId: string) {
    const existing = await this.prisma.kelas.findFirst({
      where: { id, ...tenantWhere() },
      include: { _count: { select: { users: true, sessionLinks: true } } },
    });
    if (!existing) throw new NotFoundException('Kelas tidak ditemukan');
    const { _count } = existing;
    // Kelas boleh dihapus walau masih dipakai: siswa kehilangan kelasnya
    // (kelasId → null), tautan sesi dihapus. Data ujian tidak terpengaruh.
    await this.prisma.$transaction([
      this.prisma.user.updateMany({ where: { kelasId: id }, data: { kelasId: null } }),
      this.prisma.sessionKelas.deleteMany({ where: { kelasId: id } }),
      this.prisma.kelas.delete({ where: { id } }),
    ]);
    await this.audit.log({
      actorId,
      action: 'KELAS_DELETE',
      entity: 'Kelas',
      entityId: id,
      schoolId: existing.schoolId,
      meta: { name: existing.name, detachedUsers: _count.users, removedSessionLinks: _count.sessionLinks },
    });
    return { ok: true, detachedUsers: _count.users, removedSessionLinks: _count.sessionLinks };
  }
}
