import { Controller, Get, Inject, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtPayload } from '@cbt/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { KartuCetakService } from './kartu-cetak.service';

/** Kartu Login UNIVERSAL (satu kartu per siswa, berlaku semua ujian). PROKTOR & ADMIN. */
@Controller('kartu')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PROKTOR', 'ADMIN')
export class KartuCetakController {
  constructor(@Inject(KartuCetakService) private readonly kartu: KartuCetakService) {}

  /** Pratinjau jumlah kartu yang akan dicetak. */
  @Get('count')
  count(@Query('kelasId') kelasId?: string) {
    return this.kartu.count(kelasId || undefined);
  }

  /** PDF Kartu Login (A4, 8 per halaman). `judul` = teks acara (opsional, manual). */
  @Get('pdf')
  async pdf(
    @Query('kelasId') kelasId: string | undefined,
    @Query('judul') judul: string | undefined,
    @CurrentUser() actor: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.kartu.pdf(kelasId || undefined, judul, actor.sub);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    return new StreamableFile(buffer, { length: buffer.length, type: 'application/pdf' });
  }
}
