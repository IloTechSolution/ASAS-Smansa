import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  HttpCode,
  HttpStatus,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { JwtPayload, configUpsertSchema, schoolUpdateSchema } from '@cbt/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SettingsService, parseBrandingKind } from './settings.service';
import { assertImageContent, uploadsRoot } from '../common/uploads/upload-files';

/** Konfigurasi + identitas sekolah — khusus ADMIN (terkunci ke sekolah terpilih). */
@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @Get()
  all() {
    return this.settings.all();
  }

  /** Daftar sekolah aktif — untuk switcher sekolah admin. */
  @Get('schools')
  schools() {
    return this.settings.schools();
  }

  /** Status PIN keluar APK SEB (tanpa hash). */
  @Get('seb-exit-pin')
  sebExitPinStatus() {
    return this.settings.sebExitPinStatus();
  }

  /** Simpan/ganti PIN keluar APK SEB — 4–8 angka, disimpan SHA-256. */
  @Put('seb-exit-pin')
  @HttpCode(HttpStatus.OK)
  setSebExitPin(@Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.settings.setSebExitPin(dto, actor.sub);
  }

  /** Hapus PIN keluar APK SEB (tombol keluar di APK nonaktif). */
  @Delete('seb-exit-pin')
  @HttpCode(HttpStatus.OK)
  clearSebExitPin(@CurrentUser() actor: JwtPayload) {
    return this.settings.clearSebExitPin(actor.sub);
  }

  @Put()
  upsert(@Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.settings.upsert(configUpsertSchema.parse(dto), actor.sub);
  }

  /** Identitas sekolah: nama, appName, kepala sekolah (dipakai kartu/PDF & header). */
  @Patch('school')
  updateSchool(@Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.settings.updateSchool(schoolUpdateSchema.parse(dto), actor.sub);
  }

  /** Upload gambar branding (logo | ttd kepala sekolah | stempel). Maks 2MB, PNG/JPG. */
  @Post('branding/:kind')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  async uploadBranding(
    @Param('kind') kindRaw: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() actor: JwtPayload,
  ) {
    const kind = parseBrandingKind(kindRaw);
    if (!file) throw new BadRequestException('File wajib diisi');
    const nameExt = /\.(png|jpe?g)$/i.exec(file.originalname ?? '')?.[1]?.toLowerCase().replace('jpeg', 'jpg');
    const ext = nameExt ?? (file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/jpeg' ? 'jpg' : null);
    if (ext !== 'png' && ext !== 'jpg') throw new BadRequestException('Logo/TTD/stempel harus PNG atau JPG');
    assertImageContent(file.buffer, ext);

    const schoolId = this.settings.currentSchoolId();
    const key = this.settings.brandingKeyFor(schoolId, kind, ext);
    const dir = join(uploadsRoot(), 'branding', schoolId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(uploadsRoot(), key), file.buffer);
    return this.settings.setBranding(schoolId, kind, key, actor.sub);
  }

  @Delete('branding/:kind')
  async deleteBranding(@Param('kind') kindRaw: string, @CurrentUser() actor: JwtPayload) {
    const kind = parseBrandingKind(kindRaw);
    const schoolId = this.settings.currentSchoolId();
    const key = await this.settings.brandingKey(schoolId, kind);
    if (key) {
      try {
        unlinkSync(join(uploadsRoot(), key));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
          // Jangan telan — berkas yatim membingungkan.
          this.logger.warn(`gagal menghapus ${key}: ${(e as Error).message}`);
        }
      }
    }
    return this.settings.setBranding(schoolId, kind, null, actor.sub);
  }

  /** Pratinjau gambar branding (admin) — di web di-fetch sebagai blob. */
  @Get('branding/:kind')
  async branding(@Param('kind') kindRaw: string, @Res({ passthrough: true }) res: import('express').Response) {
    const kind = parseBrandingKind(kindRaw);
    const schoolId = this.settings.currentSchoolId();
    const key = await this.settings.brandingKey(schoolId, kind);
    if (!key) throw new NotFoundException('Belum ada gambar untuk jenis ini');
    const path = join(uploadsRoot(), key);
    if (!existsSync(path)) throw new NotFoundException('Berkas tidak ditemukan');
    res.setHeader('Content-Type', key.endsWith('.png') ? 'image/png' : 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(createReadStream(path));
  }
}

/**
 * Subset konfigurasi yang aman dibaca tanpa login (brand sekolah + default
 * formulir). JANGAN tambahkan key sensitif ke daftar publik.
 */
@Controller('settings')
export class SettingsPublicController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @Get('public')
  publicValues(@Query('school') school?: string) {
    return this.settings.publicValues(school);
  }

  /** Logo sekolah (publik — tampil di kartu & header). 404 bila belum diatur. */
  @Get('public/logo')
  async publicLogo(@Query('school') school: string | undefined, @Res({ passthrough: true }) res: import('express').Response) {
    const row = await this.settings.resolvePublicSchool(school);
    if (!row?.logoPath) throw new NotFoundException('Logo sekolah belum diatur');
    const path = join(uploadsRoot(), row.logoPath);
    if (!existsSync(path)) throw new NotFoundException('Logo tidak ditemukan');
    res.setHeader('Content-Type', row.logoPath.endsWith('.png') ? 'image/png' : 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return new StreamableFile(createReadStream(path));
  }
}
