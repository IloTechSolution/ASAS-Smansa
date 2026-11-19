import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { AnswerReviewInput, JwtPayload, ResultsPublishInput, answerReviewSchema, resultsPublishSchema } from '@cbt/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { GradingService } from './grading.service';

/** Penilaian & pelaporan satu sesi — guru pemilik ujian / admin (proktor TIDAK melihat nilai). */
@Controller('sessions/:id')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GradingController {
  constructor(@Inject(GradingService) private readonly grading: GradingService) {}

  /** Papan penilaian: statistik skor, progres, jumlah review tertunda. */
  @Get('grading')
  @Roles('GURU', 'ADMIN')
  summary(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.grading.summary(id, user.sub, user.role);
  }

  /** Nilai ulang seluruh attempt yang sudah selesai (idempoten). */
  @Post('grade')
  @Roles('GURU', 'ADMIN')
  grade(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.grading.gradeSessionFor(id, user.sub, user.role);
  }

  /** Daftar jawaban isian singkat yang menunggu keputusan guru. */
  @Get('reviews')
  @Roles('GURU', 'ADMIN')
  reviews(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.grading.reviews(id, user.sub, user.role);
  }

  /** Hasil per peserta + rincian skor butir. */
  @Get('results')
  @Roles('GURU', 'ADMIN')
  results(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.grading.results(id, user.sub, user.role);
  }

  /** Analisis butir soal: tingkat kesulitan, daya pembeda, sebaran pengecoh. */
  @Get('item-analysis')
  @Roles('GURU', 'ADMIN')
  itemAnalysis(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.grading.itemAnalysis(id, user.sub, user.role);
  }

  /** Terbitkan / tarik hasil ke siswa. */
  @Post('publish')
  @Roles('GURU', 'ADMIN')
  publish(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() user: JwtPayload) {
    const parsed: ResultsPublishInput = resultsPublishSchema.parse(dto);
    return this.grading.publish(id, parsed, user.sub, user.role);
  }
}

/** Review manual satu butir jawaban (isian singkat). */
@Controller('attempts/:id')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('GURU', 'ADMIN')
export class AnswerReviewController {
  constructor(@Inject(GradingService) private readonly grading: GradingService) {}

  @Post('review')
  review(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() user: JwtPayload) {
    const parsed: AnswerReviewInput = answerReviewSchema.parse(dto);
    return this.grading.review(id, parsed, user.sub, user.role);
  }
}

/**
 * Siswa TIDAK melihat nilai di aplikasi (keputusan sekolah, 11 Nov 2026).
 * Endpoint hasil siswa (`GET /attempts/:id/result`) DIHAPUS — guru membagikan
 * nilai lewat ekspor Excel setelah semua isian singkat dinilai.
 */
