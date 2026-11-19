import { ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { assertExamManager } from '../common/session-access/session-access';
import { tenantWhere } from '../common/tenant/tenant';

/**
 * Token 6 digit rotating ala TOTP (RFC 4226/6238, HMAC-SHA1, ±1 interval).
 * Secret per sesi dibuat saat sesi dibuat (base64url, Fase 3).
 */
@Injectable()
export class TokenService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /** Hitung token untuk secret + interval + titik waktu (ms). Murni & deterministik. */
  static compute(secretBase64Url: string, intervalSec: number, atMs: number): string {
    const key = Buffer.from(secretBase64Url, 'base64url');
    const counter = Math.floor(atMs / 1000 / intervalSec);
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(counter));
    const hmac = createHmac('sha1', key).update(msg).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);
    return String(code % 1_000_000).padStart(6, '0');
  }

  /** Verifikasi dengan toleransi ±1 interval (antisipasi jam geser). */
  static matches(secretBase64Url: string, intervalSec: number, token: string, atMs: number): boolean {
    const step = intervalSec * 1000;
    return (
      TokenService.compute(secretBase64Url, intervalSec, atMs) === token ||
      TokenService.compute(secretBase64Url, intervalSec, atMs - step) === token ||
      TokenService.compute(secretBase64Url, intervalSec, atMs + step) === token
    );
  }

  private async sessionOrThrow(id: string) {
    const s = await this.prisma.examSession.findFirst({
      where: { id, ...tenantWhere() },
      include: { exam: { select: { id: true, title: true } } },
    });
    if (!s) throw new NotFoundException('Sesi tidak ditemukan');
    return s;
  }

  private snapshot(s: { tokenSecret: string; tokenIntervalSec: number }, atMs: number) {
    const stepMs = s.tokenIntervalSec * 1000;
    const token = TokenService.compute(s.tokenSecret, s.tokenIntervalSec, atMs);
    return {
      token,
      intervalSec: s.tokenIntervalSec,
      expiresInSec: Math.ceil((Math.ceil(atMs / stepMs) * stepMs - atMs) / 1000),
      serverTime: new Date(atMs).toISOString(),
    };
  }

  /** Token saat ini untuk papan pelaksanaan — hanya sesi yang tampil ke siswa. */
  async current(sessionId: string, actorId?: string, actorRole?: string) {
    if (actorId) await assertExamManager(this.prisma, sessionId, actorId, actorRole ?? 'PROKTOR');
    const s = await this.sessionOrThrow(sessionId);
    if (!s.visibleToSiswa) {
      throw new ConflictException('Sesi belum ditampilkan ke siswa — tampilkan dulu di panel pelaksanaan');
    }
    return { sessionId, status: s.status, ...this.snapshot(s, Date.now()) };
  }

  /** Rilis token: tampilkan di papan + catat audit (siapa, kapan, nilai apa). */
  async release(sessionId: string, actorId: string, note?: string | null, actorRole = 'PROKTOR') {
    await assertExamManager(this.prisma, sessionId, actorId, actorRole);
    const s = await this.sessionOrThrow(sessionId);
    if (!s.visibleToSiswa) {
      throw new ConflictException('Sesi belum ditampilkan ke siswa — tampilkan dulu untuk merilis token');
    }
    const snap = this.snapshot(s, Date.now());
    await this.prisma.tokenAudit.create({
      data: {
        sessionId,
        releasedById: actorId,
        intervalSec: s.tokenIntervalSec,
        tokenValue: snap.token,
        note: note ?? null,
        schoolId: s.schoolId,
      },
    });
    await this.audit.log({ actorId, action: 'TOKEN_RELEASE', entity: 'ExamSession', entityId: sessionId, schoolId: s.schoolId });
    return { sessionId, status: s.status, released: true as const, ...snap };
  }

  /**
   * Gerbang token untuk start attempt (ruang ujian). Memakai penghitung
   * gagal per (sesi, user) yang sama dengan verify() supaya endpoint start
   * tidak bisa dipakai menebak token tanpa batas.
   * Mengembalikan true bila cocok; menghitung kegagalan & menegakkan 429.
   */
  async checkStartGate(
    session: { id: string; tokenSecret: string; tokenIntervalSec: number },
    token: string,
    userId: string,
  ): Promise<boolean> {
    const failKey = `tokenfail:${session.id}:${userId}`;
    try {
      const fails = Number((await this.redis.get(failKey)) ?? 0);
      if (fails >= 10) {
        throw new HttpException(
          'Terlalu banyak percobaan token — tunggu ±5 menit atau minta bantuan proktor',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (e) {
      if (e instanceof HttpException) throw e;
      // Redis mati: lanjut tanpa throttle (fail-open ketersediaan ujian).
    }
    const ok = TokenService.matches(session.tokenSecret, session.tokenIntervalSec, token, Date.now());
    try {
      if (ok) {
        await this.redis.del(failKey);
      } else {
        await this.redis.incr(failKey);
        await this.redis.expire(failKey, 300);
      }
    } catch {
      // throttle best-effort
    }
    return ok;
  }

  /**
   * Gerbang token untuk siswa (dipakai ruang ujian Fase 5).
   * Anti brute-force (P2): salah tebak dihitung per user per sesi (Redis,
   * jendela 5 menit, maks 10) — lewat itu 429. Batas per-user agar salah ketik
   * wajar tak saling menghukum satu lab, tapi menebak sistematis macet total.
   */
  async verify(sessionId: string, token: string, actorId?: string) {
    const s = await this.sessionOrThrow(sessionId);
    if (s.status !== 'ACTIVE') {
      return { ok: false as const, reason: 'Sesi belum aktif' };
    }
    const failKey = `tokenfail:${sessionId}:${actorId ?? 'anon'}`;
    try {
      const fails = Number((await this.redis.get(failKey)) ?? 0);
      if (fails >= 10) {
        throw new HttpException(
          'Terlalu banyak percobaan token — tunggu ±5 menit atau minta bantuan proktor',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (e) {
      if (e instanceof HttpException) throw e;
      // Redis mati: lanjut tanpa throttle (fail-open ketersediaan ujian).
    }
    const ok = TokenService.matches(s.tokenSecret, s.tokenIntervalSec, token, Date.now());
    try {
      if (ok) {
        await this.redis.del(failKey);
      } else {
        await this.redis.incr(failKey);
        await this.redis.expire(failKey, 300);
      }
    } catch {
      // throttle best-effort
    }
    return ok
      ? { ok: true as const, sessionId }
      : { ok: false as const, reason: 'Token salah atau kedaluwarsa' };
  }
}
