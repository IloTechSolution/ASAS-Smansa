import { AsyncLocalStorage } from 'async_hooks';
import { BadRequestException } from '@nestjs/common';

/**
 * Konteks tenant per request. Disetel oleh TenantInterceptor (HTTP) dan
 * MonitoringGateway (socket). Service membaca lewat `tenantWhere()` /
 * `requireSchoolId()` tanpa perlu parameter tambahan.
 *
 * - Non-ADMIN: schoolId selalu sekolah akun (header diabaikan).
 * - ADMIN tanpa `x-school-id`: agregat lintas sekolah (hanya baca).
 * - ADMIN dengan `x-school-id`: terkunci ke sekolah itu (baca + tulis).
 */
export interface TenantContext {
  /** null = agregat semua sekolah (khusus ADMIN). */
  schoolId: string | null;
  role: string;
  /** Sekolah akun (null untuk admin agregat). */
  accountSchoolId: string | null;
}

const storage = new AsyncLocalStorage<TenantContext>();

export const tenantStorage = {
  run<T>(ctx: TenantContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
  get(): TenantContext | undefined {
    return storage.getStore();
  },
};

/** where-clause sekolah untuk model tenant. {} bila admin melihat semua. */
export function tenantWhere(): { schoolId?: string } {
  const ctx = storage.getStore();
  if (!ctx) throw new Error('Tenant context tidak tersedia');
  return ctx.schoolId ? { schoolId: ctx.schoolId } : {};
}

/** schoolId efektif; melempar bila agregat. Untuk CREATE data sekolah. */
export function requireSchoolId(): string {
  const ctx = storage.getStore();
  if (!ctx) throw new Error('Tenant context tidak tersedia');
  if (!ctx.schoolId) {
    throw new BadRequestException(
      'Pilih sekolah dulu lewat switcher sekolah di kanan atas untuk menambah data.',
    );
  }
  return ctx.schoolId;
}

/** schoolId untuk baris yang dikelola entity milik sekolah (update/hapus). */
export function entitySchoolId(entity: { schoolId: string }): string {
  return entity.schoolId;
}
