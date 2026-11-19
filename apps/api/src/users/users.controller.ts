import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtPayload, passwordResetSchema, userCreateSchema, userListQuerySchema, userUpdateSchema } from '@cbt/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UsersService } from './users.service';

/** Maksimal ukuran file import (selaras UPLOAD_MAX_MB default). */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * Manajemen pengguna — khusus ADMIN.
 * Validasi via Zod (@cbt/shared) agar identik di tsx-dev maupun tsc-prod.
 */
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  list(@Query() q: Record<string, unknown>) {
    return this.users.list(userListQuerySchema.parse(q));
  }

  @Post()
  create(@Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.users.create(userCreateSchema.parse(dto), actor.sub);
  }

  /** Unduh template Excel import pengguna. */
  /** Unduh template Excel khusus import SISWA. */
  @Get('import/siswa/template')
  async studentTemplate() {
    const buf = await this.users.buildStudentImportTemplate();
    return new StreamableFile(buf, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="template-import-siswa.xlsx"',
    });
  }

  /** Import bulk khusus SISWA (field `file`). Kelas otomatis dibuat. */
  @Post('import/siswa')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMPORT_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        const ok = /\.xlsx$/i.test(file.originalname);
        if (!ok) return cb(new BadRequestException('File harus berekstensi .xlsx'), false);
        cb(null, true);
      },
    }),
  )
  importStudents(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() actor: JwtPayload) {
    if (!file?.buffer?.length) throw new BadRequestException('File Excel wajib dilampirkan (field `file`)');
    return this.users.importStudentsExcel(file.buffer, actor.sub);
  }

  @Get('import/template')
  async template() {
    const buf = await this.users.buildImportTemplate();
    return new StreamableFile(buf, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="template-import-pengguna.xlsx"',
    });
  }

  /** Import bulk pengguna dari file Excel (field `file`). */
  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMPORT_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        const ok = /\.xlsx$/i.test(file.originalname);
        if (!ok) return cb(new BadRequestException('File harus berekstensi .xlsx'), false);
        cb(null, true);
      },
    }),
  )
  import(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() actor: JwtPayload) {
    if (!file?.buffer?.length) throw new BadRequestException('File Excel wajib dilampirkan (field `file`)');
    return this.users.importExcel(file.buffer, actor.sub);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.users.detail(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.users.update(id, userUpdateSchema.parse(dto), actor.sub);
  }

  /** Hapus SEMUA akun SISWA di sekolah aktif — hanya yang bersih; sisanya dilewati & dilaporkan. */
  @Delete('siswa/bulk')
  removeAllStudents(@Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    const confirm = (dto as { confirm?: unknown } | null)?.confirm;
    if (confirm !== 'HAPUS SEMUA SISWA') {
      throw new BadRequestException('Konfirmasi tidak cocok — kirim { confirm: "HAPUS SEMUA SISWA" }');
    }
    return this.users.removeAllStudents(actor.sub);
  }

  /** Hapus akun (permanen). Diblokir bila akun punya data ujian — nonaktifkan saja. */
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.users.remove(id, actor.sub);
  }

  @Post(':id/reset-password')
  resetPassword(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.users.resetPassword(id, passwordResetSchema.parse(dto).newPassword, actor.sub);
  }
}
