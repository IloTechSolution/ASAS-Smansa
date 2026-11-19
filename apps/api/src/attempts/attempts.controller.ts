import { Body, Controller, Get, Inject, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  JwtPayload,
  answerSaveSchema,
  attemptIntegritySchema,
  attemptStartSchema,
  attemptSubmitSchema,
  attemptUnlockSchema,
} from '@cbt/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AttemptsService } from './attempts.service';
import { SebProof, reconstructedUrl } from './seb';

/** URL absolut yang di-hash SEB (termasuk query), memakai host publik proxy. */
function sebProof(req: Request): SebProof {
  return {
    url: reconstructedUrl(req),
    hash: req.headers['x-safeexambrowser-requesthash'],
  };
}

/** Ruang ujian siswa — SEMUA endpoint khusus role SISWA (Fase 5). */
@Controller('attempts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SISWA')
export class AttemptsController {
  constructor(@Inject(AttemptsService) private readonly attempts: AttemptsService) {}

  /** Daftar sesi yang bisa dikerjakan siswa + ringkasan attempt. */
  @Get('available')
  available(@CurrentUser() user: JwtPayload) {
    return this.attempts.available(user.sub);
  }

  /** Mulai attempt: gerbang token + validasi kelas/SEB/jadwal. */
  @Post('start')
  start(@Body() dto: unknown, @CurrentUser() user: JwtPayload, @Req() req: Request) {
    return this.attempts.start(
      user.sub,
      attemptStartSchema.parse(dto),
      req.ip,
      req.headers['user-agent'] ?? null,
      sebProof(req),
    );
  }

  /** Ambil state attempt (resume setelah refresh). */
  @Get(':id')
  state(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Req() req: Request) {
    return this.attempts.state(user.sub, id, sebProof(req));
  }

  /** Autosave satu jawaban. */
  @Put(':id/answers')
  save(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() user: JwtPayload, @Req() req: Request) {
    return this.attempts.saveAnswer(user.sub, id, answerSaveSchema.parse(dto), sebProof(req));
  }

  /** Kirim jawaban (submit). */
  @Post(':id/submit')
  submit(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() user: JwtPayload, @Req() req: Request) {
    return this.attempts.submit(user.sub, id, attemptSubmitSchema.parse(dto ?? {}), sebProof(req));
  }

  /** Catat pelanggaran integritas (tab switch, fullscreen, copy, dsb). */
  @Post(':id/integrity')
  integrity(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() user: JwtPayload, @Req() req: Request) {
    return this.attempts.integrity(user.sub, id, attemptIntegritySchema.parse(dto), sebProof(req));
  }

  /** Buka attempt terkunci (batas pelanggaran) — wajib token sesi proktor. */
  @Post(':id/unlock')
  unlock(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() user: JwtPayload, @Req() req: Request) {
    return this.attempts.unlock(user.sub, id, attemptUnlockSchema.parse(dto), sebProof(req));
  }
}
