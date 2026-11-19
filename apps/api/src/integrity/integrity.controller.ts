import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { JwtPayload } from '@cbt/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { IntegrityService } from './integrity.service';

@Controller('sessions/:id/integrity')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PROKTOR', 'ADMIN', 'GURU')
export class IntegrityController {
  constructor(@Inject(IntegrityService) private readonly svc: IntegrityService) {}
  @Get()
  list(@Param('id') sessionId: string, @CurrentUser() actor: JwtPayload) { return this.svc.list(sessionId, actor.sub, actor.role); }
}

/** Monitoring pelanggaran global (semua sesi) — PROKTOR & ADMIN. */
@Controller('integrity')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PROKTOR', 'ADMIN')
export class GlobalIntegrityController {
  constructor(@Inject(IntegrityService) private readonly svc: IntegrityService) {}

  @Get()
  global(@Query('sessionId') sessionId?: string, @Query('limit') limit?: string) {
    const n = Number(limit);
    return this.svc.global(sessionId || undefined, Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 50);
  }
}
