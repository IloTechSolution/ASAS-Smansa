import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtPayload, examCandidatesQuerySchema, examCreateSchema, examEnrollSchema, examListQuerySchema, examQuestionsSetSchema, examUpdateSchema } from '@cbt/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ExamsService } from './exams.service';

/** Builder ujian — GURU (milik sendiri) & ADMIN (semua). */
@Controller('exams')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('GURU', 'ADMIN')
export class ExamsController {
  constructor(@Inject(ExamsService) private readonly exams: ExamsService) {}

  @Get()
  list(@Query() q: Record<string, unknown>, @CurrentUser() actor: JwtPayload) {
    return this.exams.list(examListQuerySchema.parse(q), actor.sub, actor.role);
  }

  @Post()
  create(@Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.exams.create(examCreateSchema.parse(dto), actor.sub);
  }

  @Get(':id')
  detail(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.exams.detail(id, actor.sub, actor.role);
  }

  /** Pratinjau BERKUNCI untuk ditinjau guru: urutan soal + statistik lintas sesi. */
  @Get(':id/preview')
  preview(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.exams.preview(id, actor.sub, actor.role);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.exams.update(id, examUpdateSchema.parse(dto), actor.sub, actor.role);
  }

  @Put(':id/questions')
  setQuestions(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.exams.setQuestions(id, examQuestionsSetSchema.parse(dto), actor.sub, actor.role);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.exams.remove(id, actor.sub, actor.role);
  }

  /** Enrol peserta: daftar terdaftar (admin/proktor/pemilik/guru utk ujian admin). */
  @Get(':id/enrollments')
  @Roles('GURU', 'ADMIN', 'PROKTOR')
  listEnrollments(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.exams.listEnrollments(id, actor.sub, actor.role);
  }

  /** Kandidat siswa aktif (dicari per nama/NISN/username, opsional per kelas). */
  @Get(':id/candidates')
  @Roles('GURU', 'ADMIN', 'PROKTOR')
  candidates(@Param('id') id: string, @Query() q: Record<string, unknown>, @CurrentUser() actor: JwtPayload) {
    return this.exams.candidates(id, examCandidatesQuerySchema.parse(q), actor.sub, actor.role);
  }

  /** Ganti penuh set peserta (kosongkan = semua kelas peserta sesi bisa melihat). */
  @Put(':id/enrollments')
  @Roles('GURU', 'ADMIN', 'PROKTOR')
  setEnrollments(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.exams.setEnrollments(id, examEnrollSchema.parse(dto), actor.sub, actor.role);
  }
}
