import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ROLES, UserCreateInput, UserListQuery, UserUpdateInput, userImportRowSchema } from '@cbt/shared';
import { hash } from 'bcryptjs';
import { readFirstSheet, writeWorkbook } from '../common/excel/excel.helper';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppConfigService } from '../common/config/app-config.service';
import { RedisService } from '../common/redis/redis.service';
import { revokeUserRefreshes } from '../auth/refresh-sessions';
import { encryptSecret } from '../common/crypto/secret-box';
import { requireSchoolId, tenantWhere } from '../common/tenant/tenant';
import { normalizeRuang } from './user-ruang';

const SAFE_SELECT = {
  id: true,
  username: true,
  name: true,
  role: true,
  nisn: true,
  ruang: true,
  photoUrl: true,
  isActive: true,
  schoolId: true,
  kelasId: true,
  createdAt: true,
  updatedAt: true,
  school: { select: { id: true, slug: true, name: true } },
  kelas: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(AppConfigService) private readonly appConfig: AppConfigService,
  ) {}

  findByUsername(username: string) {
    return this.prisma.user.findFirst({
      where: { username, isActive: true },
      include: { kelas: { select: { id: true, name: true } } },
    });
  }

  findSafeById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        nisn: true,
        ruang: true,
        photoUrl: true,
        isActive: true,
        schoolId: true,
        kelasId: true,
        kelas: { select: { id: true, name: true } },
      },
    });
  }

  /** List dengan paginasi + filter (admin), ter-scope sekolah. */
  async list(q: UserListQuery) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const where: Prisma.UserWhereInput = { ...tenantWhere() };
    if (q.role) where.role = q.role;
    if (q.kelasId) where.kelasId = q.kelasId;
    if (typeof q.isActive === 'boolean') where.isActive = q.isActive;
    if (q.search?.trim()) {
      const s = q.search.trim();
      where.OR = [
        { username: { contains: s, mode: 'insensitive' } },
        { name: { contains: s, mode: 'insensitive' } },
        { nisn: { contains: s } },
      ];
    }
    const [total, data] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: SAFE_SELECT,
        orderBy: [{ role: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { data, total, page, limit };
  }

  async detail(id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, ...tenantWhere() }, select: SAFE_SELECT });
    if (!user) throw new NotFoundException('Pengguna tidak ditemukan');
    return user;
  }

  /** Aturan domain: siswa wajib NISN + kelas (satu sekolah), username siswa = NISN. */
  private async assertSiswaRules(
    input: { role?: string; username?: string; nisn?: string | null; kelasId?: string | null },
    isCreate: boolean,
    schoolId?: string,
  ) {
    if (input.role !== 'SISWA') return;
    if (isCreate || input.nisn !== undefined) {
      if (!input.nisn || !/^\d{10}$/.test(input.nisn)) {
        throw new BadRequestException('Siswa wajib punya NISN 10 digit');
      }
    }
    if (isCreate || input.kelasId !== undefined) {
      if (!input.kelasId) throw new BadRequestException('Siswa wajib punya kelas');
      const kelas = await this.prisma.kelas.findFirst({ where: { id: input.kelasId, ...(schoolId ? { schoolId } : tenantWhere()) } });
      if (!kelas) throw new BadRequestException('Kelas tidak ditemukan di sekolah ini');
    }
    if (isCreate && input.username !== input.nisn) {
      throw new BadRequestException('Username siswa harus sama dengan NISN');
    }
  }

  private async assertUnique(username: string, nisn: string | null | undefined, excludeId?: string) {
    const clash = await this.prisma.user.findFirst({
      where: {
        id: excludeId ? { not: excludeId } : undefined,
        OR: [
          { username },
          ...(nisn ? [{ nisn }] : []),
        ],
      },
      select: { id: true, username: true, nisn: true },
    });
    if (clash) {
      if (clash.username === username) throw new ConflictException('Username sudah dipakai');
      throw new ConflictException('NISN sudah dipakai');
    }
  }

  async create(dto: UserCreateInput, actorId: string, opts?: { silent?: boolean }) {
    const schoolId = requireSchoolId();
    await this.assertSiswaRules(dto, true, schoolId);
    if (dto.nisn && !/^\d{10}$/.test(dto.nisn)) {
      throw new BadRequestException('NISN harus 10 digit angka');
    }
    if (dto.kelasId) {
      const kelas = await this.prisma.kelas.findFirst({ where: { id: dto.kelasId, schoolId } });
      if (!kelas) throw new BadRequestException('Kelas tidak ditemukan di sekolah ini');
    }
    await this.assertUnique(dto.username, dto.nisn ?? null);
    try {
      const user = await this.prisma.user.create({
        data: {
          username: dto.username,
          password: await hash(dto.password, 10),
          initialPassword: encryptSecret(dto.password),
          name: dto.name,
          role: dto.role,
          nisn: dto.nisn ?? null,
          kelasId: dto.kelasId ?? null,
          ruang: normalizeRuang(dto.ruang, dto.role),
          schoolId,
          isActive: true,
        },
        select: SAFE_SELECT,
      });
      if (!opts?.silent) {
        await this.audit.log({ actorId, action: 'USER_CREATE', entity: 'User', entityId: user.id, schoolId, meta: { username: user.username, role: user.role } });
      }
      return user;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Username/NISN sudah dipakai');
      }
      throw e;
    }
  }

  async update(id: string, dto: UserUpdateInput, actorId: string) {
    const existing = await this.prisma.user.findFirst({ where: { id, ...tenantWhere() } });
    if (!existing) throw new NotFoundException('Pengguna tidak ditemukan');
    if (id === actorId) {
      if (dto.isActive === false) throw new ForbiddenException('Tidak bisa menonaktifkan akun sendiri');
      if (dto.role && dto.role !== existing.role) {
        throw new ForbiddenException('Tidak bisa mengubah role akun sendiri');
      }
    }
    const nextRole = dto.role ?? existing.role;
    await this.assertSiswaRules(
      { role: nextRole, nisn: dto.nisn !== undefined ? dto.nisn : existing.nisn, kelasId: dto.kelasId !== undefined ? dto.kelasId : existing.kelasId },
      false,
      existing.schoolId,
    );
    if (dto.nisn && !/^\d{10}$/.test(dto.nisn)) {
      throw new BadRequestException('NISN harus 10 digit angka');
    }
    if (dto.kelasId) {
      const kelas = await this.prisma.kelas.findFirst({ where: { id: dto.kelasId, schoolId: existing.schoolId } });
      if (!kelas) throw new BadRequestException('Kelas tidak ditemukan di sekolah ini');
    }
    if (dto.nisn !== undefined) {
      await this.assertUnique(existing.username, dto.nisn, id);
    }
    try {
      const user = await this.prisma.user.update({
        where: { id },
        data: {
          name: dto.name ?? undefined,
          role: dto.role ?? undefined,
          nisn: dto.nisn !== undefined ? dto.nisn : undefined,
          kelasId: dto.kelasId !== undefined ? dto.kelasId : undefined,
          ruang:
            dto.ruang !== undefined
              ? normalizeRuang(dto.ruang, nextRole)
              : nextRole === 'SISWA'
                ? existing.ruang
                : null,
          isActive: dto.isActive ?? undefined,
        },
        select: SAFE_SELECT,
      });
      await this.audit.log({ actorId, action: 'USER_UPDATE', entity: 'User', entityId: id, schoolId: existing.schoolId, meta: { changes: dto } });
      return user;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('NISN sudah dipakai');
      }
      throw e;
    }
  }

  /**
   * Hapus akun (permanen) — hanya bila akun bersih dari data ujian.
   * Relasi CASCADE (attempt/absensi/kartu) akan menghapus rekaman ujian
   * siswa, dan relasi RESTRICT (soal/ujian/rilis token) akan meledak di DB;
   * keduanya ditolak 409 — akun berdata cukup dinonaktifkan.
   */
  async remove(id: string, actorId: string) {
    if (id === actorId) throw new ForbiddenException('Tidak bisa menghapus akun sendiri');
    const existing = await this.prisma.user.findFirst({
      where: { id, ...tenantWhere() },
      select: { id: true, username: true, name: true, role: true, schoolId: true },
    });
    if (!existing) throw new NotFoundException('Pengguna tidak ditemukan');
    const [attempts, attendances, questions, exams, released] = await Promise.all([
      this.prisma.attempt.count({ where: { userId: id } }),
      this.prisma.attendance.count({ where: { userId: id } }),
      this.prisma.question.count({ where: { createdById: id } }),
      this.prisma.exam.count({ where: { createdById: id } }),
      this.prisma.tokenAudit.count({ where: { releasedById: id } }),
    ]);
    const reasons: string[] = [];
    if (attempts > 0) reasons.push(`${attempts} attempt`);
    if (attendances > 0) reasons.push(`${attendances} absensi`);
    if (questions > 0) reasons.push(`${questions} soal`);
    if (exams > 0) reasons.push(`${exams} ujian`);
    if (released > 0) reasons.push(`${released} rilis token`);
    if (reasons.length > 0) {
      throw new ConflictException(
        `Akun "${existing.username}" punya data (${reasons.join(', ')}) — tidak bisa dihapus; nonaktifkan saja`,
      );
    }
    await this.prisma.user.delete({ where: { id } });
    try {
      await revokeUserRefreshes(this.redis, id);
    } catch {
      // abaikan bila Redis mati; akun sudah terhapus
    }
    await this.audit.log({
      actorId,
      action: 'USER_DELETE',
      entity: 'User',
      entityId: id,
      schoolId: existing.schoolId,
      meta: { username: existing.username, name: existing.name, role: existing.role },
    });
    return { ok: true };
  }

  /**
   * Hapus SEMUA akun SISWA di sekolah aktif (admin; mode agregat ditolak).
   * Hanya akun bersih yang dihapus permanen; yang punya data ujian dilewati
   * dan dilaporkan. Konfirmasi ganda dijaga route controller (body confirm).
   */
  async removeAllStudents(actorId: string) {
    const schoolId = requireSchoolId();
    const students = await this.prisma.user.findMany({
      where: { role: 'SISWA', ...tenantWhere() },
      select: { id: true, username: true, name: true },
    });
    if (students.length === 0) return { deleted: 0, skipped: [] };
    const ids = students.map((s) => s.id);
    const [attempts, attendances, questions, exams, released] = await Promise.all([
      this.prisma.attempt.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _count: { _all: true } }),
      this.prisma.attendance.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _count: { _all: true } }),
      this.prisma.question.groupBy({ by: ['createdById'], where: { createdById: { in: ids } }, _count: { _all: true } }),
      this.prisma.exam.groupBy({ by: ['createdById'], where: { createdById: { in: ids } }, _count: { _all: true } }),
      this.prisma.tokenAudit.groupBy({ by: ['releasedById'], where: { releasedById: { in: ids } }, _count: { _all: true } }),
    ]);
    const busy = new Map<string, string[]>();
    const mark = (uid: string | null, note: string) => {
      if (!uid) return;
      const arr = busy.get(uid) ?? [];
      arr.push(note);
      busy.set(uid, arr);
    };
    for (const r of attempts) mark(r.userId, `${r._count._all} attempt`);
    for (const r of attendances) mark(r.userId, `${r._count._all} absensi`);
    for (const r of questions) mark(r.createdById, `${r._count._all} soal`);
    for (const r of exams) mark(r.createdById, `${r._count._all} ujian`);
    for (const r of released) mark(r.releasedById, `${r._count._all} rilis token`);

    const deletable = students.filter((s) => !busy.has(s.id));
    const skipped = students
      .filter((s) => busy.has(s.id))
      .map((s) => ({ username: s.username, reason: busy.get(s.id)!.join(', ') }));

    if (deletable.length > 0) {
      await this.prisma.user.deleteMany({ where: { id: { in: deletable.map((s) => s.id) } } });
      for (const s of deletable) {
        try {
          await revokeUserRefreshes(this.redis, s.id);
        } catch {
          // abaikan bila Redis mati — akun sudah terhapus
        }
      }
    }
    await this.audit.log({
      actorId,
      action: 'USER_BULK_DELETE',
      entity: 'User',
      schoolId,
      meta: {
        total: students.length,
        deleted: deletable.length,
        skipped: skipped.length,
        skippedUsernames: skipped.slice(0, 50).map((s) => s.username),
      },
    });
    return { deleted: deletable.length, skipped };
  }

  async resetPassword(id: string, newPassword: string, actorId: string) {
    const existing = await this.prisma.user.findFirst({ where: { id, ...tenantWhere() }, select: { id: true, schoolId: true } });
    if (!existing) throw new NotFoundException('Pengguna tidak ditemukan');
    await this.prisma.user.update({
      where: { id },
      data: { password: await hash(newPassword, 10), initialPassword: encryptSecret(newPassword) },
    });
    // Reset admin = sesi si pemilik akun ikut mati (termasuk milik penyerang).
    try {
      await revokeUserRefreshes(this.redis, id);
    } catch {
      // abaikan bila Redis mati; password baru tetap berlaku
    }
    await this.audit.log({ actorId, action: 'USER_RESET_PASSWORD', entity: 'User', entityId: id, schoolId: existing.schoolId });
    return { ok: true };
  }

  /** Template Excel import (header + 2 baris contoh). */
  buildImportTemplate(): Promise<Buffer> {
    return writeWorkbook([
      {
        name: 'Pengguna',
        header: ['Username', 'Password', 'Nama', 'Role', 'NISN', 'Kelas'],
        rows: [
          ['0099881100', 'Siswa123!', 'Siswa Contoh', 'SISWA', '0099881100', 'XII IPA 1'],
          ['guru3', 'Guru123!', 'Guru Tiga', 'GURU', '', ''],
        ],
        widths: [14, 12, 22, 10, 14, 14],
      },
    ]);
  }

  /**
   * Import bulk dari buffer Excel. Sheet pertama, header:
   * Username | Password | Nama | Role | NISN | Kelas (nama kelas).
   * Per baris independen: sukses dicatat, gagal dilaporkan (tidak menggagalkan semua).
   */
  async importExcel(buffer: Buffer, actorId: string) {
    const schoolId = requireSchoolId();
    let rows: Array<Record<string, string>> | null;
    try {
      rows = await readFirstSheet(buffer);
    } catch {
      throw new BadRequestException('File Excel tidak valid');
    }
    if (rows === null) throw new BadRequestException('File Excel kosong');
    if (rows.length === 0) throw new BadRequestException('Tidak ada baris data');
    if (rows.length > 2000) throw new BadRequestException('Maksimal 2000 baris per import');

    const kelasList = await this.prisma.kelas.findMany({ where: { schoolId }, select: { id: true, name: true } });
    const kelasByName = new Map(kelasList.map((k) => [k.name.trim().toLowerCase(), k.id]));

    const success: Array<{ row: number; username: string }> = [];
    const failed: Array<{ row: number; username: string; error: string }> = [];
    for (let i = 0; i < rows.length; i++) {
      const excelRow = i + 2; // +1 header, +1 basis-1
      const cell = (k: string) => String(rows[i][k] ?? '').trim();
      const username = cell('Username') || cell('username');
      try {
        const roleRaw = (cell('Role') || cell('role')).toUpperCase();
        if (!(ROLES as readonly string[]).includes(roleRaw)) {
          throw new BadRequestException(`Role "${cell('Role')}" tidak valid (ADMIN/GURU/SISWA/PROKTOR)`);
        }
        const role = roleRaw as (typeof ROLES)[number];
        let nisn = cell('NISN') || cell('nisn') || cell('Nisn');
        if (role === 'SISWA' && !nisn && /^\d{10}$/.test(username)) nisn = username;
        const password = cell('Password') || cell('password');
        const name = cell('Nama') || cell('nama') || cell('Name');
        const kelasName = cell('Kelas') || cell('kelas');
        // Aturan baris import wajib sama dengan POST /users (bukan hanya
        // cek non-empty) agar data dari Excel tidak melewati validasi.
        const parsed = userImportRowSchema.safeParse({
          username,
          password,
          name,
          role,
          nisn: nisn || undefined,
          kelasName: kelasName || undefined,
        });
        if (!parsed.success) {
          throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Data baris tidak valid');
        }
        const row = parsed.data;
        let kelasId: string | null = null;
        if (row.kelasName) {
          const found = kelasByName.get(row.kelasName.toLowerCase());
          if (!found) throw new BadRequestException(`Kelas "${row.kelasName}" tidak ditemukan di sekolah ini`);
          kelasId = found;
        }
        await this.create(
          {
            username: row.username,
            password: row.password,
            name: row.name,
            role: row.role,
            nisn: row.nisn || null,
            kelasId,
          },
          actorId,
          { silent: true },
        );
        success.push({ row: excelRow, username: row.username });
      } catch (e) {
        const msg =
          e instanceof BadRequestException || e instanceof ConflictException
            ? e.message
            : 'Gagal memproses baris';
        failed.push({ row: excelRow, username: username || '-', error: msg });
      }
    }
    await this.audit.log({
      actorId,
      action: 'USER_IMPORT',
      entity: 'User',
      schoolId,
      meta: { total: rows.length, success: success.length, failed: failed.length },
    });
    return { total: rows.length, success, failed };
  }

  /** Template Excel khusus import SISWA (NISN = username, kelas otomatis dibuat). */
  buildStudentImportTemplate(): Promise<Buffer> {
    return writeWorkbook([
      {
        name: 'Siswa',
        header: ['NISN', 'Nama', 'Password', 'Kelas', 'Ruang'],
        rows: [
          ['0099881101', 'Aisyah Putri', 'Siswa123!', 'XII IPA 1', '12'],
          ['0099881102', 'Bima Sakti', 'Siswa123!', 'XII IPA 1', '12'],
          ['0099881103', 'Citra Lestari', 'Siswa123!', 'X IPS 2', '21'],
        ],
        widths: [14, 26, 14, 18, 12],
      },
    ]);
  }

  private tingkatOf(kelasName: string): string | null {
    const m = kelasName.trim().match(/^(XII|XI|X)(?=[s.-]|$)/i);
    return m ? m[1].toUpperCase() : null;
  }

  /** Cari kelas by nama (per sekolah); bila belum ada, buat otomatis (TA dari konfigurasi sekolah). */
  private async findOrCreateKelas(kelasName: string, schoolId: string) {
    const name = kelasName.trim();
    const existing = await this.prisma.kelas.findUnique({ where: { schoolId_name: { schoolId, name } } });
    if (existing) return existing;
    const tahunAjaran = await this.appConfig.getString('TAHUN_AJARAN', '2026/2027', schoolId);
    try {
      return await this.prisma.kelas.create({
        data: { name, tingkat: this.tingkatOf(name), tahunAjaran, schoolId },
      });
    } catch (e) {
      // Balapan dua import bersamaan — ambil yang sudah dibuat.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await this.prisma.kelas.findUnique({ where: { schoolId_name: { schoolId, name } } });
        if (again) return again;
      }
      throw e;
    }
  }

  /**
   * Import bulk khusus SISWA. Sheet pertama, header: NISN | Nama | Password | Kelas | Ruang.
   * Kelas yang belum ada otomatis dibuat di sekolah aktif (TAHUN_AJARAN konfigurasi sekolah).
    * Kolom Ruang opsional — bila diisi, mengatur Ruang Ujian SISWA (kolom `User.ruang`).
    * Kolom kelas `Kelas.ruang` tetap diperbarui seperti sebelumnya (dipakai Kartu Login).
   * Per baris independen: sukses dicatat, gagal dilaporkan.
   */
  async importStudentsExcel(buffer: Buffer, actorId: string) {
    const schoolId = requireSchoolId();
    let rows: Array<Record<string, string>> | null;
    try {
      rows = await readFirstSheet(buffer);
    } catch {
      throw new BadRequestException('File Excel tidak valid');
    }
    if (rows === null) throw new BadRequestException('File Excel kosong');
    if (rows.length === 0) throw new BadRequestException('Tidak ada baris data');
    if (rows.length > 2000) throw new BadRequestException('Maksimal 2000 baris per import');

    const cell = (r: Record<string, unknown>, names: string[]) => {
      for (const k of names) {
        const v = r[k];
        if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
      }
      return '';
    };

    const success: Array<{ row: number; username: string }> = [];
    const failed: Array<{ row: number; username: string; error: string }> = [];
    // Ruang per kelasId (baris terakhir menang). Diterapkan walau baris siswa
    // gagal (mis. NISN duplikat) — admin bisa memakai ulang file yang sama hanya
    // untuk memperbarui Ruang Ujian kelas. Diterapkan batch setelah loop.
    const ruangPlan = new Map<string, string>();
    // Ruang per siswa (NISN) — baris terakhir menang. Dipakai ulang file yang sama
    // untuk memperbarui ruang walau baris siswanya duplikat.
    const siswaRuangPlan = new Map<string, string>();
    const tahunAjaran = await this.appConfig.getString('TAHUN_AJARAN', '2026/2027', schoolId);
    for (let i = 0; i < rows.length; i++) {
      const excelRow = i + 2;
      const username = cell(rows[i], ['NISN', 'Nisn', 'nisn', 'Username', 'username']);
      try {
        const name = cell(rows[i], ['Nama', 'nama', 'Name', 'name']);
        const password = cell(rows[i], ['Password', 'password']);
        const kelasName = cell(rows[i], ['Kelas', 'kelas']);
        const ruang = cell(rows[i], ['Ruang', 'ruang', 'RUANG', 'Room', 'room', 'Ruang Ujian']);
        if (!/^\d{10}$/.test(username)) {
          throw new BadRequestException('NISN harus 10 digit angka');
        }
        if (!name) throw new BadRequestException('Nama wajib diisi');
        if (!password) throw new BadRequestException('Password wajib diisi');
        if (!kelasName) throw new BadRequestException('Kelas wajib diisi');

        const kelas = await this.findOrCreateKelas(kelasName, schoolId);
        if (ruang) {
          ruangPlan.set(kelas.id, ruang.slice(0, 30));
          const ruangSiswa = normalizeRuang(ruang, 'SISWA');
          if (ruangSiswa) siswaRuangPlan.set(username, ruangSiswa);
        }

        await this.create(
          {
            username,
            password,
            name,
            role: 'SISWA',
            nisn: username,
            kelasId: kelas.id,
            ruang,
          },
          actorId,
          { silent: true },
        );
        success.push({ row: excelRow, username });
      } catch (e) {
        const msg =
          e instanceof BadRequestException || e instanceof ConflictException
            ? e.message
            : 'Gagal memproses baris';
        failed.push({ row: excelRow, username: username || '-', error: msg });
      }
    }
    // Terapkan kolom Ruang ke kelas (hanya bila nilainya berbeda). Diterapkan
    // walau baris siswanya gagal — lihat komentar ruangPlan di atas.
    let ruangUpdates = 0;
    for (const [kelasId, ruangValue] of ruangPlan) {
      // OR ruang:null karena SQL "NULL <> 'x'" bernilai NULL (bukan true).
      const r = await this.prisma.kelas.updateMany({
        where: { id: kelasId, OR: [{ ruang: null }, { ruang: { not: ruangValue } }] },
        data: { ruang: ruangValue },
      });
      ruangUpdates += r.count;
    }
    let siswaRuangUpdates = 0;
    for (const [username, ruangValue] of siswaRuangPlan) {
      const r = await this.prisma.user.updateMany({
        where: { username, ...tenantWhere(), OR: [{ ruang: null }, { ruang: { not: ruangValue } }] },
        data: { ruang: ruangValue },
      });
      siswaRuangUpdates += r.count;
    }

    await this.audit.log({
      actorId,
      action: 'USER_IMPORT_STUDENT',
      entity: 'User',
      schoolId,
      meta: { total: rows.length, success: success.length, failed: failed.length, tahunAjaran, ruangUpdates, siswaRuangUpdates },
    });
    return { total: rows.length, success, failed, ruangUpdates, siswaRuangUpdates };
  }
}
