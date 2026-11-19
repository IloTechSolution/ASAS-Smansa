import { Body, Controller, Get, Inject, Param, Put, UseGuards } from '@nestjs/common';
import { JwtPayload, attendanceSetSchema } from '@cbt/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AttendanceService } from './attendance.service';

/** Absensi digital — PROKTOR, ADMIN & GURU pemilik sesi. */
@Controller('sessions/:id/attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PROKTOR', 'ADMIN', 'GURU')
export class AttendanceController {
  constructor(@Inject(AttendanceService) private readonly attendance: AttendanceService) {}

  @Get()
  list(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.attendance.list(id, actor.sub, actor.role);
  }

  @Put()
  set(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.attendance.set(id, attendanceSetSchema.parse(dto), actor.sub, actor.role);
  }
}
