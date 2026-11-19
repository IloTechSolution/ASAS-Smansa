import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import { sebExitVerifySchema } from '@cbt/shared';
import { keyFingerprint, normalizeSebHash, parseSebKeys, reconstructedUrl, verifySebRequest } from '../attempts/seb';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { SEB_EXIT_FAIL_MAX, SEB_EXIT_FAIL_WINDOW_SEC, SEB_EXIT_PIN_KEY, hashPin, pinNeedsUpgrade, verifyPinAgainstHash } from './seb-exit-pin';

/**
 * Endpoint umum untuk verifikasi konfigurasi Safe Exam Browser — SENGAJA
 * publik: klien SEB (APK kiosk) belum tentu punya JWT saat operator menguji
 * key. Tidak membocorkan key (hanya sidik jari 8 hex), dan tidak bisa
 * dipakai oracle brute-force (hash 256-bit dihitung dari key yang sudah
 * dimiliki penyerang).
 */
@Controller('seb')
export class SebController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('self-test')
  @HttpCode(HttpStatus.OK)
  selfTest(@Req() req: Request) {
    const keys = parseSebKeys(process.env.SEB_BROWSER_EXAM_KEY);
    const fingerprints = keys.map(keyFingerprint);
    if (keys.length === 0) {
      throw new ServiceUnavailableException({
        ok: false,
        status: 'SERVER_NOT_CONFIGURED',
        message: 'SEB_BROWSER_EXAM_KEY belum diisi di server — sesi wajib SEB akan ditolak.',
      });
    }
    const proof = { url: reconstructedUrl(req), hash: req.headers['x-safeexambrowser-requesthash'] };
    if (normalizeSebHash(proof.hash) && verifySebRequest(proof, keys)) {
      return { ok: true, status: 'OK', fingerprints };
    }
    throw new HttpException(
      {
        ok: false,
        status: 'HASH_MISMATCH',
        message: 'Hash tidak cocok — key di klien berbeda dengan SEB_BROWSER_EXAM_KEY di server.',
        fingerprints,
      },
      HttpStatus.BAD_REQUEST,
    );
  }

  /**
   * Verifikasi PIN keluar APK — diatur admin per sekolah (Pengaturan → "PIN
   * Keluar APK SEB"). Publik (perangkat sekolah belum tentu login), tapi
   * rate-limited per sekolah + IP: salah 10 kali dalam 5 menit → 429.
   *
   * 200 { ok: true }                      → APK boleh menutup aplikasi
   * 200 { ok: false, configured: true }   → PIN salah
   * 200 { ok: false, configured: false }  → admin belum mengatur PIN (tombol keluar dinonaktifkan)
   * 400                                    → payload tidak valid
   * 429                                    → terlalu banyak percobaan
   */
  @Post('exit-verify')
  @HttpCode(HttpStatus.OK)
  async exitVerify(@Body() body: unknown, @Req() req: Request) {
    const dto = sebExitVerifySchema.parse(body);
    const ip = this.clientIp(req);
    const school = await this.resolveSchool(dto.school);
    if (!school) {
      return { ok: false, configured: false, message: 'Sekolah tidak dikenal — PIN keluar tidak bisa diverifikasi.' };
    }

    const failKey = `sebpinfail:${school.id}:${ip}`;
    try {
      const fails = Number((await this.redis.get(failKey)) ?? 0);
      if (fails >= SEB_EXIT_FAIL_MAX) {
        throw new HttpException(
          { ok: false, message: 'Terlalu banyak percobaan — tunggu 5 menit.' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (e) {
      if (e instanceof HttpException) throw e;
      // Redis error → fail-open untuk hitung gagal, tapi verifikasi PIN tetap di bawah.
    }

    const row = await this.prisma.globalConfig.findUnique({
      where: { schoolId_key: { schoolId: school.id, key: SEB_EXIT_PIN_KEY } },
      select: { value: true },
    });
    if (!row?.value) {
      return { ok: false, configured: false, message: 'PIN keluar belum diatur oleh admin sekolah.' };
    }
    if (verifyPinAgainstHash(dto.pin, row.value)) {
      await this.redis.del(failKey).catch(() => undefined);
      // Upgrade hash legacy (SHA-256 tanpa salt) ke HMAC — best-effort.
      if (pinNeedsUpgrade(row.value)) {
        await this.prisma.globalConfig
          .update({
            where: { schoolId_key: { schoolId: school.id, key: SEB_EXIT_PIN_KEY } },
            data: { value: hashPin(dto.pin) },
          })
          .catch(() => undefined);
      }
      return { ok: true, configured: true };
    }
    await this.registerFailure(failKey);
    return { ok: false, configured: true, message: 'PIN salah.' };
  }

  private async resolveSchool(param?: string) {
    const wanted = param?.trim();
    const defaultSlug = (process.env.DEFAULT_SCHOOL_SLUG ?? 'sman1').trim();
    return wanted
      ? this.prisma.school.findFirst({ where: { OR: [{ id: wanted }, { slug: wanted }], isActive: true }, select: { id: true } })
      : this.prisma.school.findUnique({ where: { slug: defaultSlug }, select: { id: true } });
  }

  private clientIp(req: Request): string {
    // Express & `trust proxy` (loopback/linklocal/uniquelocal) sudah menghitung
    // req.ip dari X-Forwarded-For hanya bila proxy terpercaya — header mentah
    // dari klien tidak dipakai agar throttle tidak bisa dilewati.
    return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  }

  private async registerFailure(failKey: string) {
    try {
      const n = await this.redis.incr(failKey);
      if (n === 1) await this.redis.expire(failKey, SEB_EXIT_FAIL_WINDOW_SEC);
    } catch {
      // Redis error → counter tidak naik; verifikasi tetap jalan.
    }
  }
}
