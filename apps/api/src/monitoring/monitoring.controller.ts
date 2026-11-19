import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { JwtPayload, monitorExtendSchema, monitorWarnSchema, attemptResetSchema } from '@cbt/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { MonitoringService } from './monitoring.service';

/** Papan monitoring live per sesi — PROKTOR, ADMIN & GURU pemilik. */
@Controller('sessions/:id/monitoring')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PROKTOR', 'ADMIN', 'GURU')
export class MonitoringController {
  constructor(@Inject(MonitoringService) private readonly monitoring: MonitoringService) {}

  @Get()
  board(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.monitoring.board(id, actor.sub, actor.role);
  }

  /** Bangkitkan ulang snapshot ke semua klien yang sudah bergabung. */
  @Post('refresh')
  async refresh(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    await this.monitoring.assertBoardAccess(id, actor.sub, actor.role);
    return this.monitoring.broadcastBoard(id);
  }
}

/** Kendali attempt per peserta — PROKTOR, ADMIN & GURU pemilik (cek kepemilikan di service). */
@Controller('attempts/:id')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PROKTOR', 'ADMIN', 'GURU')
export class AttemptControlController {
  constructor(@Inject(MonitoringService) private readonly monitoring: MonitoringService) {}

  @Post('warn')
  warn(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.monitoring.warn(id, monitorWarnSchema.parse(dto), actor.sub, actor.name, actor.role);
  }

  @Post('extend')
  extend(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.monitoring.extend(id, monitorExtendSchema.parse(dto), actor.sub, actor.role);
  }

  @Post('force-submit')
  forceSubmit(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.monitoring.forceSubmit(id, actor.sub, actor.role);
  }

  /** Remedial — reset attempt satu siswa agar bisa mengerjakan ulang. PROKTOR/ADMIN/GURU pemilik. */
  @Post('reset')
  reset(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    const parsed = attemptResetSchema.parse(dto ?? {});
    return this.monitoring.resetForRemedial(id, parsed, actor.sub, actor.role);
  }
}
