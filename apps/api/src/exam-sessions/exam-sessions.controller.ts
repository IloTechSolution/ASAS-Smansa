import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtPayload, sessionCreateSchema, sessionKelasSetSchema, sessionListQuerySchema, sessionStatusSchema, sessionUpdateSchema, sessionVisibilitySchema } from '@cbt/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ExamSessionsService } from './exam-sessions.service';

/** Sesi ujian — GURU (ujian milik sendiri/ujian admin), ADMIN (semua), PROKTOR (pelaksanaan, tanpa buat/hapus). */
@Controller('sessions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('GURU', 'ADMIN')
export class ExamSessionsController {
  constructor(@Inject(ExamSessionsService) private readonly sessions: ExamSessionsService) {}

  /** PROKTOR boleh melihat daftar sesi (tanpa hak ubah). */
  @Get()
  @Roles('GURU', 'ADMIN', 'PROKTOR')
  list(@Query() q: Record<string, unknown>, @CurrentUser() actor: JwtPayload) {
    return this.sessions.list(sessionListQuerySchema.parse(q), actor.sub, actor.role);
  }

  @Post()
  create(@Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.sessions.create(sessionCreateSchema.parse(dto), actor.sub, actor.role);
  }

  /** PROKTOR boleh membaca detail sesi untuk keperluan panel. */
  @Get(':id')
  @Roles('GURU', 'ADMIN', 'PROKTOR')
  detail(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.sessions.detail(id, actor.sub, actor.role);
  }

  /** PROKTOR boleh mengatur pelaksanaan (jadwal/aturan) sesi mana pun. */
  @Patch(':id')
  @Roles('GURU', 'ADMIN', 'PROKTOR')
  update(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.sessions.update(id, sessionUpdateSchema.parse(dto), actor.sub, actor.role);
  }

  /** PROKTOR boleh mengatur kelas peserta sesi mana pun. */
  @Put(':id/kelas')
  @Roles('GURU', 'ADMIN', 'PROKTOR')
  setKelas(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.sessions.setKelas(id, sessionKelasSetSchema.parse(dto), actor.sub, actor.role);
  }

  /** Tampilkan / sembunyikan ujian ke siswa — saklar pelaksanaan (menggantikan alur status). */
  @Patch(':id/visibility')
  @Roles('GURU', 'ADMIN', 'PROKTOR')
  setVisibility(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.sessions.setVisibility(id, sessionVisibilitySchema.parse(dto), actor.sub, actor.role);
  }

  /** Tutup & kumpul paksa semua peserta yang masih mengerjakan (tombol darurat). */
  @Post(':id/close')
  @Roles('GURU', 'ADMIN', 'PROKTOR')
  close(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.sessions.closeForcibly(id, actor.sub, actor.role);
  }

  /** Kompatibilitas lama — dipetakan ke visibilitas/penutupan paksa. */
  @Patch(':id/status')
  @Roles('GURU', 'ADMIN', 'PROKTOR')
  setStatus(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.sessions.setStatus(id, sessionStatusSchema.parse(dto), actor.sub, actor.role);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.sessions.remove(id, actor.sub, actor.role);
  }
}
