import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtPayload, mapelCreateSchema, mapelKkmSchema, mapelUpdateSchema } from '@cbt/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { MapelService } from './mapel.service';

/**
 * Manajemen mata pelajaran.
 * Baca: semua staf (guru butuh daftar mapel saat membuat ujian). Tulis: ADMIN.
 */
@Controller('mapel')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class MapelController {
  constructor(@Inject(MapelService) private readonly mapel: MapelService) {}

  @Get()
  @Roles('ADMIN', 'GURU', 'PROKTOR')
  list() {
    return this.mapel.list();
  }

  @Post()
  create(@Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.mapel.create(mapelCreateSchema.parse(dto), actor.sub);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.mapel.update(id, mapelUpdateSchema.parse(dto), actor.sub);
  }

  /** KKM diatur oleh guru mata pelajaran (dan admin). */
  @Patch(':id/kkm')
  @Roles('ADMIN', 'GURU')
  setKkm(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.mapel.setKkm(id, mapelKkmSchema.parse(dto).kkm, actor.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.mapel.remove(id, actor.sub);
  }
}
