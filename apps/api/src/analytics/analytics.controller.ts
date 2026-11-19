import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { JwtPayload } from '@cbt/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AnalyticsService } from './analytics.service';

/** Analitik ujian — guru pemilik ujian & admin (proktor tidak melihat nilai). */
@Controller('exams/:id/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'GURU')
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly svc: AnalyticsService) {}

  @Get()
  stats(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.svc.examStats(id, actor.sub, actor.role);
  }
}
