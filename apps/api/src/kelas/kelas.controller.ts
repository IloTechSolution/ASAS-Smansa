import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtPayload, kelasCreateSchema, kelasUpdateSchema } from '@cbt/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { KelasService } from './kelas.service';

/**
 * Manajemen kelas + tahun ajaran.
 * Baca: semua staf (guru butuh daftar kelas untuk memilih peserta sesi,
 * proktor untuk membaca penempatan). Tulis: khusus ADMIN.
 */
@Controller('kelas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class KelasController {
  constructor(@Inject(KelasService) private readonly kelas: KelasService) {}

  @Get()
  @Roles('ADMIN', 'GURU', 'PROKTOR')
  list(@Query('tahunAjaran') tahunAjaran?: string) {
    return this.kelas.list(tahunAjaran);
  }

  @Get('tahun-ajaran')
  @Roles('ADMIN', 'GURU', 'PROKTOR')
  tahunAjaran() {
    return this.kelas.tahunAjaran();
  }

  @Post()
  create(@Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.kelas.create(kelasCreateSchema.parse(dto), actor.sub);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.kelas.update(id, kelasUpdateSchema.parse(dto), actor.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.kelas.remove(id, actor.sub);
  }
}
