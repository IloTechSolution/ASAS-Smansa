import { Controller, Get, Inject, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtPayload } from '@cbt/shared';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ExportService } from './export.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Hanya karakter aman untuk nama berkas pada header Content-Disposition. */
const safeFilenamePart = (raw: string) => raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'sesi';

/** Export data pelaksanaan → Excel/PDF. PROKTOR/ADMIN bebas; GURU pemilik ujiannya. */
@Controller('sessions/:id/export')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PROKTOR', 'ADMIN')
export class ExportController {
  constructor(
    @Inject(ExportService) private readonly export_: ExportService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async send(res: Response, buffer: Buffer, filename: string, sessionId: string, kind: string, actor: JwtPayload) {
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
    // Unduhan berisi data pribadi (nama/NISN/absensi) — catat siapa mengunduh apa.
    await this.audit.log({
      actorId: actor.sub,
      action: 'EXPORT_DOWNLOAD',
      entity: 'ExamSession',
      entityId: sessionId,
      meta: { kind, bytes: buffer.length },
    });
  }

  @Get('absensi')
  @Roles('GURU', 'ADMIN', 'PROKTOR')
  async absensi(@Param('id') id: string, @Res({ passthrough: true }) res: Response, @CurrentUser() user: JwtPayload) {
    await this.send(res, await this.export_.attendanceXlsx(id, user.sub, user.role), `absensi-${safeFilenamePart(id)}.xlsx`, id, 'absensi', user);
  }

  @Get('ringkasan')
  @Roles('GURU', 'ADMIN', 'PROKTOR')
  async ringkasan(@Param('id') id: string, @Res({ passthrough: true }) res: Response, @CurrentUser() user: JwtPayload) {
    await this.send(res, await this.export_.ringkasanXlsx(id, user.sub, user.role), `ringkasan-${safeFilenamePart(id)}.xlsx`, id, 'ringkasan', user);
  }

  /** Rekap nilai (KKM + ketuntasan) — guru pemilik ujian / admin. */
  @Get('nilai')
  @Roles('GURU', 'ADMIN')
  async nilai(@Param('id') id: string, @Res({ passthrough: true }) res: Response, @CurrentUser() user: JwtPayload) {
    await this.send(res, await this.export_.nilaiXlsx(id, user.sub, user.role), `nilai-${safeFilenamePart(id)}.xlsx`, id, 'nilai', user);
  }

  /** Daftar hadir ujian (PDF, kolom tanda tangan kosong) — untuk absen manual & cetak. */
  @Get('absensi/pdf')
  @Roles('GURU', 'ADMIN', 'PROKTOR')
  async absensiPdf(@Param('id') id: string, @Res({ passthrough: true }) res: Response, @CurrentUser() user: JwtPayload) {
    const { buffer, filename } = await this.export_.absensiPdf(id, user.sub, user.role);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
    await this.audit.log({
      actorId: user.sub,
      action: 'EXPORT_DOWNLOAD',
      entity: 'ExamSession',
      entityId: id,
      meta: { kind: 'absensi-pdf', bytes: buffer.length },
    });
  }
}
