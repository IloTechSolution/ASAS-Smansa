import { BadRequestException, CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { tenantStorage } from './tenant';

interface AuthedRequest {
  user?: { sub: string; role: string; schoolId?: string | null };
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Menyelaraskan identitas sekolah ke konteks tenant per-request.
 * Berjalan SETELAH guard (guard men-set req.user), SEBELUM handler.
 *
 * Non-ADMIN selalu terkunci ke sekolah akun (header `x-school-id` diabaikan).
 * ADMIN boleh mengirim `x-school-id` (id atau slug sekolah) untuk terkunci ke
 * satu sekolah; tanpa header = mode agregat baca-saja lintas sekolah.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = req.user;
    if (!user) return next.handle();

    let schoolId: string | null = user.schoolId ?? null;
    if (user.role === 'ADMIN') {
      const raw = req.headers['x-school-id'];
      const wanted = String(Array.isArray(raw) ? raw[0] : raw ?? '').trim();
      if (wanted && wanted !== 'all') {
        const school = await this.prisma.school.findFirst({
          where: { OR: [{ id: wanted }, { slug: wanted }], isActive: true },
          select: { id: true },
        });
        if (!school) {
          // Sekolah tidak dikenal — jangan diam-diam agregat (bisa bikin salah paham data).
          throw new BadRequestException(`Sekolah "${wanted}" tidak dikenal`);
        }
        schoolId = school.id;
      } else {
        schoolId = null; // mode agregat
      }
    }

    // Mode agregat = baca-saja untuk ADMIN. Cegah operasi tulis lintas sekolah
    // yang tidak pernah memanggil requireSchoolId() (update sesi, publish nilai,
    // kendali attempt, dll). Kecuali endpoint milik akun sendiri / penandatangan
    // URL yang tidak mengubah data sekolah manapun.
    const method = String((req as unknown as { method?: string }).method ?? 'GET').toUpperCase();
    if (user.role === 'ADMIN' && schoolId === null && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const path = String((req as unknown as { path?: string; url?: string }).path ?? (req as unknown as { url?: string }).url ?? '');
      const safe = /\/auth\//.test(path) || /\/uploads\/sign(?:\?|$)/.test(path);
      if (!safe) {
        throw new BadRequestException(
          'Mode agregat hanya untuk baca — pilih sekolah lewat switcher (kanan atas) untuk mengubah data.',
        );
      }
    }

    return new Observable((subscriber) => {
      tenantStorage.run(
        { schoolId, role: user.role, accountSchoolId: user.schoolId ?? null },
        () => {
          next.handle().subscribe({
            next: (v) => subscriber.next(v),
            error: (e) => subscriber.error(e),
            complete: () => subscriber.complete(),
          });
        },
      );
    });
  }
}
