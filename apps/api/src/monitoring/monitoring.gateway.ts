import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { JwtPayload } from '@cbt/shared';
import type { Server, Socket } from 'socket.io';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { PRESENCE_KEY, PRESENCE_MAX_AGE_MS } from '../presence/presence-keys';
import { tenantStorage } from '../common/tenant/tenant';
import { assertExamManager } from '../common/session-access/session-access';
import { AttemptSessionLookup } from './attempt-session-lookup';
import { heartbeatKey, heartbeatMapFromMget } from './heartbeat-batch';

/** SessionId attempt hasil join bertahan seharian (maks durasi ujian 8 jam). */
const ATTEMPT_SESSION_TTL_SEC = 24 * 60 * 60;

/** Payload kendali proktor yang dikirim ke klien siswa. */
export interface AttemptControlPayload {
  type: 'extend' | 'force-submit';
  attemptId: string;
  expiresAt?: string;
  submittedAt?: string;
  reason?: string;
}

/**
 * Monitoring realtime (Fase 6).
 * - Siswa: `attempt:join` → ruang `attempt:{id}`, menerima `warn` & `attempt:control`.
 * - Proktor: `monitor:join` → ruang `session:{id}`, menerima `monitor:status`.
 * - Heartbeat siswa disimpan di Redis untuk ditampilkan di papan proktor.
 */
@WebSocketGateway({
  namespace: '/monitoring',
  cors: { origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',') },
})
export class MonitoringGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(MonitoringGateway.name);
  private readonly attemptSessions: AttemptSessionLookup;

  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {
    this.attemptSessions = new AttemptSessionLookup(this.redis, ATTEMPT_SESSION_TTL_SEC);
  }

  /**
   * Autentikasi dari `handshake.auth.token` (JWT yang sama dengan REST).
   * Socket tanpa token sah langsung diputus — tidak dibiarkan menganggur
   * menahan koneksi hanya untuk ditolak di setiap pesan.
   * Sama seperti JwtStrategy: wajib type 'access'. Cek isActive ke DB bersifat
   * asinkron — bila gagal, socket yang terlanjur lolos langsung diputus.
   */
  handleConnection(client: Socket) {
    const raw = (client.handshake.auth as { token?: unknown } | undefined)?.token;
    let payload: (JwtPayload & { type?: string }) | null = null;
    try {
      payload = this.jwt.verify<JwtPayload & { type?: string }>(String(raw ?? ''), {
        secret: process.env.JWT_SECRET,
      });
      if (payload.type !== 'access') {
        throw new Error('bukan access token');
      }
    } catch {
      payload = null;
    }
    if (!payload) {
      (client.data as { user?: JwtPayload }).user = undefined;
      this.logger.warn(`Koneksi socket ditolak (token tidak valid): ${client.id}`);
      client.disconnect(true);
      return;
    }
    (client.data as { user?: JwtPayload }).user = payload;
    if (payload.role === 'SISWA') void this.touchPresence(payload.sub);
    // Tutup socket milik akun nonaktif walau tokennya belum kedaluwarsa.
      void this.prisma.user
      .findUnique({ where: { id: payload.sub }, select: { isActive: true, role: true } })
      .then((db) => {
        if (!db?.isActive) {
          this.logger.warn(`Socket diputus (akun nonaktif): ${client.id}`);
          (client.data as { user?: JwtPayload }).user = undefined;
          client.disconnect(true);
          return;
        }
        // Role terbaru dari DB (perubahan role langsung berlaku di reconnect).
        (client.data as { user?: JwtPayload }).user = { ...payload!, role: db.role as JwtPayload['role'] };
        if (db.role === 'SISWA') void this.touchPresence(payload!.sub);
      })
      .catch((e) => this.logger.warn(`Cek akun socket gagal: ${(e as Error).message}`));
  }

  private user(client: Socket): JwtPayload | undefined {
    return (client.data as { user?: JwtPayload }).user;
  }

  /** Tandai siswa aktif (dipakai presence app-level — halaman "Siswa Online"). */
  private async touchPresence(userId: string) {
    const now = Date.now();
    try {
      await this.redis.zadd(PRESENCE_KEY, now, userId);
      await this.redis.zremrangebyscore(PRESENCE_KEY, 0, now - PRESENCE_MAX_AGE_MS);
    } catch {
      // Presence adalah penyempurnaan — jangan gagalkan socket.
    }
  }

  /**
   * Siswa hanya boleh masuk ruang attempt miliknya sendiri.
   * Sekali query DB menghasilkan sessionId yang dipakai join sekaligus cache heartbeat.
   */
  private async ownedSessionId(attemptId: string, studentId: string, schoolId: string | null): Promise<string | null> {
    const a = await this.prisma.attempt.findFirst({
      where: { id: attemptId, ...(schoolId ? { schoolId } : {}) },
      select: { userId: true, sessionId: true },
    });
    return a && a.userId === studentId ? a.sessionId : null;
  }

  /**
   * Skop sekolah pemanggil socket. Non-ADMIN selalu terkunci ke sekolah akun.
   * ADMIN: `handshake.auth.schoolId` (id/slug) bila dikirim web (switcher);
   * tanpa itu = mode agregat (boleh melihat semua, papan tetap baca-saja).
   * Hasil validasi di-cache di client.data agar tidak query berulang.
   */
  private async schoolScope(client: Socket): Promise<string | null> {
    const u = this.user(client);
    if (!u) return null;
    if (u.role !== 'ADMIN') return u.schoolId ?? null;
    const data = client.data as { schoolIdChecked?: string; schoolId?: string | null };
    const raw = String((client.handshake.auth as { schoolId?: unknown } | undefined)?.schoolId ?? '').trim();
    if (!raw || raw === 'all') return null;
    if (data.schoolIdChecked === raw) return data.schoolId ?? null;
    const school = await this.prisma.school.findFirst({
      where: { OR: [{ id: raw }, { slug: raw }], isActive: true },
      select: { id: true },
    });
    data.schoolIdChecked = raw;
    data.schoolId = school?.id ?? null;
    return data.schoolId;
  }

  /* ----------------------------- masuk ruang ----------------------------- */

  @SubscribeMessage('monitor:join')
  async joinMonitor(@ConnectedSocket() client: Socket, @MessageBody() sessionId: unknown) {
    const u = this.user(client);
    if (!u) return { ok: false as const, error: 'Belum terautentikasi' };
    if (u.role !== 'PROKTOR' && u.role !== 'ADMIN' && u.role !== 'GURU') {
      return { ok: false as const, error: 'Hanya proktor/admin/pemilik ujian' };
    }
    if (typeof sessionId !== 'string' || !sessionId) {
      return { ok: false as const, error: 'Sesi tidak valid' };
    }
    const scope = await this.schoolScope(client);
    // Otorisasi sama dengan REST: ADMIN/PROKTOR bebas, GURU hanya sesi ujian
    // miliknya (atau ujian buatan ADMIN). Sebelumnya semua peran di sekolah
    // bisa mendengarkan papan sesi guru lain.
    try {
      await tenantStorage.run(
        { schoolId: scope, role: u.role, accountSchoolId: u.schoolId ?? null },
        () => assertExamManager(this.prisma, sessionId, u.sub, u.role),
      );
    } catch (e) {
      if (e instanceof NotFoundException) {
        return { ok: false as const, error: 'Sesi tidak ditemukan di sekolah Anda' };
      }
      return { ok: false as const, error: 'Anda bukan pemilik ujian/sesi ini' };
    }
    client.join(`session:${sessionId}`);
    return { ok: true as const, room: `session:${sessionId}` };
  }

  @SubscribeMessage('attempt:join')
  async joinAttempt(@ConnectedSocket() client: Socket, @MessageBody() attemptId: unknown) {
    const u = this.user(client);
    if (!u) return { ok: false as const, error: 'Belum terautentikasi' };
    if (u.role !== 'SISWA') return { ok: false as const, error: 'Hanya siswa' };
    if (typeof attemptId !== 'string' || !attemptId) {
      return { ok: false as const, error: 'Attempt tidak valid' };
    }
    const scope = await this.schoolScope(client);
    const sessionId = await this.ownedSessionId(attemptId, u.sub, scope);
    if (!sessionId) {
      return { ok: false as const, error: 'Attempt bukan milik Anda' };
    }
    await this.attemptSessions.remember(attemptId, u.sub, sessionId);
    client.join(`attempt:${attemptId}`);
    return { ok: true as const, room: `attempt:${attemptId}` };
  }

  /** Ditembak tiap 25 dtk dari ruang ujian; menandakan peserta masih online. */
  @SubscribeMessage('attempt:heartbeat')
  async heartbeat(@ConnectedSocket() client: Socket, @MessageBody() attemptId: unknown) {
    const u = this.user(client);
    if (!u || u.role !== 'SISWA' || typeof attemptId !== 'string' || !attemptId) {
      return { ok: false as const };
    }
    const scope = await this.schoolScope(client);
    // Tanpa cek ini, siswa bisa menandai attempt peserta lain sebagai "online".
    // Cache diisi saat attempt:join; bila belum ada, otorisasi ulang dari DB.
    const sessionId = await this.attemptSessions.get(attemptId, u.sub, () =>
      this.ownedSessionId(attemptId, u.sub, scope),
    );
    if (!sessionId) {
      return { ok: false as const };
    }
    try {
      const key = heartbeatKey(attemptId);
      await this.redis.set(key, String(Date.now()));
      await this.redis.expire(key, 90);
    } catch {
      // heartbeat adalah penyempurnaan, bukan prasyarat
    }
    void this.touchPresence(u.sub);
    // Deteksi online proktor bersifat event-driven — papan tak perlu
    // polling cepat; heartbeat ini sekaligus sinyal refresh yang ringan.
    this.notifyActivity(sessionId, attemptId, 'heartbeat');
    return { ok: true as const };
  }

  /* ------------------------------ pemancar ------------------------------- */

  /** Snapshot penuh sesi → papan proktor (dipakai saat kontrol proktor). */
  broadcastSessionStatus(sessionId: string, payload: unknown) {
    try {
      this.server?.to(`session:${sessionId}`).emit('monitor:snapshot', payload);
    } catch (e) {
      this.logger.warn(`Gagal broadcast monitor:snapshot ${(e as Error).message}`);
    }
  }

  /** Sinyal ringkas: ada perubahan (awal ujian, autosave, submit, pelanggaran). */
  notifyActivity(sessionId: string, attemptId: string, kind: string) {
    try {
      this.server
        ?.to(`session:${sessionId}`)
        .emit('monitor:activity', { sessionId, attemptId, kind, at: new Date().toISOString() });
    } catch (e) {
      this.logger.warn(`Gagal emit monitor:activity ${(e as Error).message}`);
    }
  }

  /** Peringatan proktor → satu peserta. */
  sendWarn(attemptId: string, payload: { message: string; from: string }) {
    try {
      this.server?.to(`attempt:${attemptId}`).emit('warn', payload);
    } catch (e) {
      this.logger.warn(`Gagal emit warn ${(e as Error).message}`);
    }
  }

  /** Kendali proktor (extend / force submit) → satu peserta. */
  sendControl(payload: AttemptControlPayload) {
    try {
      this.server?.to(`attempt:${payload.attemptId}`).emit('attempt:control', payload);
    } catch (e) {
      this.logger.warn(`Gagal emit control ${(e as Error).message}`);
    }
  }

  /**
   * Ambil semua heartbeat papan dalam SATU MGET. Sebelumnya papan melakukan
   * satu GET Redis per attempt (400 GET setiap refresh).
   */
  async lastHeartbeats(attemptIds: string[]): Promise<Map<string, number>> {
    if (attemptIds.length === 0) return new Map();
    try {
      const values = await this.redis.mget(...attemptIds.map(heartbeatKey));
      return heartbeatMapFromMget(attemptIds, values);
    } catch {
      return new Map();
    }
  }
}
