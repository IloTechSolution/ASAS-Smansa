import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { auditLogQuerySchema } from '@cbt/shared';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { AuditService } from './audit.service';

/** Baca jejak audit — khusus ADMIN. */
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  list(@Query() q: Record<string, unknown>) {
    return this.audit.list(auditLogQuerySchema.parse(q));
  }
}
