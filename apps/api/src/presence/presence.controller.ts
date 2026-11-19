import { Controller, Get, HttpCode, HttpStatus, Inject, Post, Query, UseGuards } from '@nestjs/common';
import { JwtPayload } from '@cbt/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { tenantWhere } from '../common/tenant/tenant';
import { ONLINE_MS, PRESENCE_KEY, PRESENCE_MAX_AGE_MS, RECENT_MS } from './presence-keys';

/**
 * Presence siswa (app-level, bukan DB login): ditulis oleh `POST /presence/ping`
 * dari app shell + heartbeat socket `/monitoring` (siswa yang ada di ruang ujian
 * ikut tercatat). Dibaca oleh halaman "Siswa Online" (PROKTOR/ADMIN).
 * Tidak merekam isi jawaban — hanya status online & waktu terakhir aktif.
 */
@Controller('presence')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PresenceController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /** Dipanggil dari app shell siswa tiap ±45 detik + dari gateway `/monitoring`. */
  @Post('ping')
  @Roles('SISWA')
  @HttpCode(HttpStatus.OK)
  async ping(@CurrentUser() actor: JwtPayload) {
    await this.touch(actor.sub);
    return { ok: true };
  }

  /** Tulis/refresh presence — dipakai handler lain (gateway) juga. */
  async touch(userId: string) {
    const now = Date.now();
    try {
      await this.redis.zadd(PRESENCE_KEY, now, userId);
      await this.redis.zremrangebyscore(PRESENCE_KEY, 0, now - PRESENCE_MAX_AGE_MS);
    } catch {
      // Presence adalah penyempurnaan — jangan gagalkan request utama.
    }
  }

  /** Daftar siswa yang online/baru saja keluar + yang sedang di ruang ujian. */
  @Get('siswa')
  @Roles('PROKTOR', 'ADMIN')
  async listSiswa(@Query('recent') recentParam?: string) {
    const now = Date.now();
    const includeRecent = (recentParam ?? 'true').toLowerCase() !== 'false';
    const window_ = includeRecent ? RECENT_MS : ONLINE_MS;

    let raw: string[] = [];
    try {
      raw = await this.redis.zrangebyscore(PRESENCE_KEY, now - window_, now, 'WITHSCORES');
    } catch {
      raw = [];
    }
    const seen = new Map<string, number>();
    for (let i = 0; i < raw.length; i += 2) {
      const ms = Number(raw[i + 1]);
      if (Number.isFinite(ms)) seen.set(raw[i], ms);
    }
    if (seen.size === 0) {
      return { serverTime: new Date(now).toISOString(), onlineCount: 0, inExamCount: 0, recentCount: 0, data: [] };
    }

    const ids = [...seen.keys()];
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, role: 'SISWA', ...tenantWhere() },
      select: {
        id: true,
        name: true,
        username: true,
        nisn: true,
        kelas: { select: { name: true } },
      },
    });
    if (users.length === 0) {
      return { serverTime: new Date(now).toISOString(), onlineCount: 0, inExamCount: 0, recentCount: 0, data: [] };
    }
    const userIds = users.map((u) => u.id);
    const inProgress = await this.prisma.attempt.findMany({
      where: { userId: { in: userIds }, status: 'IN_PROGRESS', ...tenantWhere() },
      select: {
        userId: true,
        session: { select: { id: true, title: true, exam: { select: { title: true } } } },
      },
    });
    const examByUser = new Map(inProgress.map((a) => [a.userId, { sessionId: a.session.id, title: a.session.title ?? a.session.exam.title }]));

    const rows = users.map((u) => {
      const lastSeenMs = seen.get(u.id) ?? 0;
      const online = now - lastSeenMs < ONLINE_MS;
      const exam = examByUser.get(u.id) ?? null;
      return {
        id: u.id,
        name: u.name,
        username: u.username,
        nisn: u.nisn,
        kelas: u.kelas,
        lastSeenAt: new Date(lastSeenMs).toISOString(),
        online,
        inExam: exam,
      };
    });
    rows.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      if (Boolean(a.inExam) !== Boolean(b.inExam)) return a.inExam ? -1 : 1;
      return b.lastSeenAt.localeCompare(a.lastSeenAt);
    });

    const onlineCount = rows.filter((r) => r.online).length;
    const inExamCount = rows.filter((r) => r.inExam).length;
    const recentCount = rows.filter((r) => !r.online).length;
    return {
      serverTime: new Date(now).toISOString(),
      onlineCount,
      inExamCount,
      recentCount,
      data: rows,
    };
  }
}
