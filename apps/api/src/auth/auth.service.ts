import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ChangePasswordInput, JwtPayload, Role } from '@cbt/shared';
import { compare, hash } from 'bcryptjs';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { schoolSummary } from '../common/tenant/school-summary';
import {
  consumeRefresh,
  newJti,
  parseDurationSec,
  revokeRefresh,
  revokeUserRefreshes,
  storeRefresh,
} from './refresh-sessions';

/** Hash bcrypt dummy — dibandingkan saat user tidak ada agar waktu respons konstan. */
const DUMMY_BCRYPT_HASH = '$2a$10$0oZk4jn.TUJ3mziXUgl.UO0YVIckGjkI.pDfGIc6685tmuG36zlVO';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /** Token akses singkat (default15m). */
  private signAccess(payload: JwtPayload) {
    return this.jwt.signAsync({ ...payload, type: 'access' });
  }

  /** TTL refresh (detik) — dipakai JWT sekaligus TTL catatan sesi di Redis. */
  private refreshTtlSec() {
    return parseDurationSec(this.config.get<string>('JWT_REFRESH_EXPIRES_IN'), 7 * 86400);
  }

  /**
   * Token pembaruan panjang (JWT_REFRESH_EXPIRES_IN, default7d) — tanpa akses API.
   * Tiap token dicatat di Redis (`jti`) agar bisa dirotasi & dicabut (P1).
   */
  private async signRefresh(payload: JwtPayload) {
    const jti = newJti();
    const token = await this.jwt.signAsync(
      { ...payload, type: 'refresh', jti },
      { expiresIn: (this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d') as import('ms').StringValue },
    );
    try {
      await storeRefresh(this.redis, jti, payload.sub, this.refreshTtlSec());
    } catch (e) {
      // Redis mati = sesi tak terlacak; token tetap diterbitkan agar login
      // tidak lumpuh total (trade-off ketersediaan, dicatat di sini).
      this.logger.warn(`Gagal mencatat sesi refresh di Redis (login tetap dilanjutkan): ${(e as Error).message}`);
    }
    return token;
  }

  /** Ambang & jendela throttle login (env, default 5 gagal / 5 menit). */
  private loginPolicy() {
    const rawMax = Number(this.config.get<string>('LOGIN_MAX_FAILURES') ?? 5);
    const rawWindow = Number(this.config.get<string>('LOGIN_WINDOW_SEC') ?? 300);
    return {
      max: Number.isFinite(rawMax) && rawMax >= 1 ? Math.floor(rawMax) : 5,
      windowSec: Number.isFinite(rawWindow) && rawWindow >= 10 ? Math.floor(rawWindow) : 300,
    };
  }

  /** Kunci per IP+username: menyerang satu akun tidak mengunci akun lain. */
  private loginKey(ip: string | undefined, username: string) {
    return `login:fail:${ip || 'unknown'}:${username.trim().toLowerCase()}`;
  }

  /** Kunci per akun saja: botnet yang memutar IP tetap tidak bisa menebak tanpa batas. */
  private accountKey(username: string) {
    return `login:acct:${username.trim().toLowerCase()}`;
  }

  private async assertLoginAllowed(key: string) {
    const { max, windowSec } = this.loginPolicy();
    try {
      const failures = Number((await this.redis.get(key)) ?? 0);
      if (failures >= max) {
        const ttl = await this.redis.ttl(key);
        const retrySec = ttl > 0 ? ttl : windowSec;
        throw new HttpException(
          `Terlalu banyak percobaan login. Coba lagi dalam ${retrySec} detik.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (e) {
      if (e instanceof HttpException) throw e;
      // Redis mati: jangan lumpuhkan login. Throttle adalah lapisan tambahan.
      this.logger.warn(`Throttle login tidak tersedia: ${(e as Error).message}`);
    }
  }

  private async noteLoginFailure(key: string) {
    const { windowSec } = this.loginPolicy();
    try {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, windowSec);
    } catch (e) {
      this.logger.warn(`Gagal mencatat percobaan login: ${(e as Error).message}`);
    }
  }

  private async clearLoginFailures(key: string) {
    try {
      await this.redis.del(key);
    } catch {
      // abaikan — counter kedaluwarsa sendiri
    }
  }

  async login(dto: LoginDto, expectedRole?: Role, ip?: string) {
    const key = this.loginKey(ip, dto.username);
    const acctKey = this.accountKey(dto.username);
    await this.assertLoginAllowed(key);
    await this.assertLoginAllowed(acctKey);

    // Bandingkan hash walau user tidak ada — mencegah oracle username dari
    // selisih waktu respons (enum akun lewat timing).
    const user = await this.users.findByUsername(dto.username);
    const passwordOk = await compare(dto.password, user?.password ?? DUMMY_BCRYPT_HASH);
    if (!user || !user.isActive || !passwordOk) {
      await this.noteLoginFailure(key);
      await this.noteLoginFailure(acctKey);
      throw new UnauthorizedException('Username/NISN atau password salah');
    }
    if (expectedRole && user.role !== expectedRole) {
      await this.noteLoginFailure(key);
      await this.noteLoginFailure(acctKey);
      throw new UnauthorizedException(`Akun ini bukan akun ${expectedRole.toLowerCase()}`);
    }
    await this.clearLoginFailures(key);
    await this.clearLoginFailures(acctKey);

    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      name: user.name,
      role: user.role as Role,
      schoolId: user.role === 'ADMIN' ? null : user.schoolId,
    };
    const accessToken = await this.signAccess(payload);
    const refreshToken = await this.signRefresh(payload);
    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        kelasId: user.kelasId,
        school: await schoolSummary(this.prisma, user.schoolId),
      },
    };
  }

  /**
   * Tukar refresh token lama dengan access token baru (+ refresh baru: ROTASI).
   * Dibutuhkan ujian panjang: token akses hanya15m sedangkan durasi ujian bisa berjam-jam.
   * Refresh lama hangus sekali pakai — token curian yang sudah dipakai pemilik
   * asli langsung mati (tidak hidup 7 hari).
   */
  async refresh(refreshToken: string) {
    let payload: JwtPayload & { type?: string; jti?: string };
    try {
      payload = await this.jwt.verifyAsync<JwtPayload & { type?: string; jti?: string }>(refreshToken);
    } catch {
      throw new UnauthorizedException('Refresh token tidak valid atau kedaluwarsa');
    }
    if (payload.type !== 'refresh' || !payload.jti) {
      throw new UnauthorizedException('Refresh token tidak valid');
    }
    // Rotasi: jti harus masih tercatat & langsung dihanguskan.
    try {
      const owner = await consumeRefresh(this.redis, payload.jti);
      if (!owner || owner !== payload.sub) {
        throw new UnauthorizedException('Sesi telah berakhir — silakan login kembali');
      }
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      // Redis mati: tolak saja (fail-closed) daripada menerbitkan sesi abadi.
      throw new UnauthorizedException('Layanan sesi tidak tersedia — coba lagi');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, isActive: true, username: true, name: true, role: true, schoolId: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Akun tidak aktif');
    }
    const next: JwtPayload = {
      sub: user.id,
      username: user.username,
      name: user.name,
      role: user.role as Role,
      schoolId: user.role === 'ADMIN' ? null : user.schoolId,
    };
    return {
      accessToken: await this.signAccess(next),
      refreshToken: await this.signRefresh(next),
    };
  }

  /**
   * Logout: cabut refresh token pemanggil (best-effort, selalu `{ok:true}`
   * agar klien tak membocorkan status token).
   */
  async logout(refreshToken: string) {
    try {
      const payload = this.jwt.decode(refreshToken) as { jti?: string } | null;
      if (payload?.jti) await revokeRefresh(this.redis, payload.jti);
    } catch {
      // abaikan — tujuan logout tercapai selama klien membuang tokennya
    }
    return { ok: true as const };
  }

  async me(userId: string) {
    const user = await this.users.findSafeById(userId);
    if (!user) return null;
    return { ...user, school: await schoolSummary(this.prisma, user.schoolId) };
  }

  /** Ganti password mandiri (Fase 5). */
  async changePassword(userId: string, dto: ChangePasswordInput) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true },
    });
    if (!user) throw new UnauthorizedException('Akun tidak ditemukan');
    const ok = await compare(dto.currentPassword, user.password);
    if (!ok) throw new BadRequestException('Password saat ini salah');
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('Password baru harus berbeda dari password lama');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: await hash(dto.newPassword, 10) },
    });
    // Password berganti = semua sesi perangkat lain ikut mati (anti pembajakan).
    try {
      await revokeUserRefreshes(this.redis, userId);
    } catch {
      // Redis mati: password tetap sudah diganti; sesi lama kedaluwarsa sendiri.
    }
    await this.audit.log({ actorId: userId, action: 'USER_CHANGE_PASSWORD', entity: 'User', entityId: userId });
    return { ok: true };
  }
}
