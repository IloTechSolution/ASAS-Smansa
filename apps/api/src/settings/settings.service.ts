import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CONFIG_KEYS, ConfigKey, ConfigUpsertInput, SchoolUpdateInput, sebExitPinSchema } from '@cbt/shared';
import { AppConfigService } from '../common/config/app-config.service';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { tenantWhere } from '../common/tenant/tenant';
import { hashPin, SEB_EXIT_PIN_KEY } from '../seb/seb-exit-pin';

/** Key yang aman ditampilkan publik (default form, KKM). */
export const PUBLIC_CONFIG_KEYS = [
  'TAHUN_AJARAN',
  'TOKEN_DEFAULT_INTERVAL_SEC',
  'MAX_VIOLATIONS_DEFAULT',
  'REQUIRE_SEB_DEFAULT',
  'KKM_DEFAULT',
] as const;

const BRANDING_KINDS = ['logo', 'ttd', 'stamp'] as const;
export type BrandingKind = (typeof BRANDING_KINDS)[number];
export function parseBrandingKind(raw: string): BrandingKind {
  if ((BRANDING_KINDS as readonly string[]).includes(raw)) return raw as BrandingKind;
  throw new BadRequestException('Jenis branding harus logo | ttd | stamp');
}

/**
 * Konfigurasi + identitas sekolah — khusus ADMIN.
 * Semua operasi terkunci ke SEKOLAH YANG DIPILIH admin (switcher). Di mode
 * agregat (Semua Sekolah) seluruh endpoint menolak dengan 400.
 */
@Injectable()
export class SettingsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AppConfigService) private readonly appConfig: AppConfigService,
  ) {}

  /** Sekolah terkunci admin; 400 bila mode agregat. */
  currentSchoolId(): string {
    const schoolId = tenantWhere().schoolId;
    if (!schoolId) {
      throw new BadRequestException('Pilih sekolah dulu lewat switcher sekolah di kanan atas.');
    }
    return schoolId;
  }

  async all() {
    const schoolId = this.currentSchoolId();
    const [rows, school] = await Promise.all([
      this.prisma.globalConfig.findMany({ where: { schoolId }, orderBy: { key: 'asc' } }),
      this.prisma.school.findUnique({ where: { id: schoolId } }),
    ]);
    const values: Record<string, string> = {};
    for (const r of rows) {
      // Rahasia (hash PIN keluar APK) — hanya statusnya yang boleh keluar.
      if (r.key === SEB_EXIT_PIN_KEY) continue;
      values[r.key] = r.value;
    }
    return { keys: [...CONFIG_KEYS], values, school };
  }

  /** Perbarui identitas sekolah (nama, appName, kepala sekolah). */
  async updateSchool(dto: SchoolUpdateInput, actorId: string) {
    const schoolId = this.currentSchoolId();
    const school = await this.prisma.school.update({
      where: { id: schoolId },
      data: {
        name: dto.name,
        appName: dto.appName,
        headmasterName: dto.headmasterName?.trim() ? dto.headmasterName.trim() : null,
        headmasterNip: dto.headmasterNip?.trim() ? dto.headmasterNip.trim() : null,
      },
    });
    await this.audit.log({ actorId, action: 'SCHOOL_UPDATE', entity: 'School', entityId: schoolId, schoolId, meta: { name: school.name, appName: school.appName } });
    return school;
  }

  /** Sekolah untuk konteks publik (login/kartu): ?school=slug|id, kosong = sekolah default. */
  async resolvePublicSchool(schoolParam?: string) {
    const defaultSlug = (process.env.DEFAULT_SCHOOL_SLUG ?? 'sman1').trim();
    return schoolParam
      ? this.prisma.school.findFirst({ where: { OR: [{ id: schoolParam }, { slug: schoolParam }], isActive: true } })
      : this.prisma.school.findUnique({ where: { slug: defaultSlug } });
  }

  /** Subset aman untuk halaman publik (tanpa autentikasi). */
  async publicValues(schoolParam?: string) {
    const school = await this.resolvePublicSchool(schoolParam);
    if (!school) {
      return { SCHOOL_NAME: 'CBT SMAN 1 & 8 Gorontalo', APP_NAME: 'CBT SMAN 1 & 8 Gorontalo', TAHUN_AJARAN: '2026/2027' };
    }
    const rows = await this.prisma.globalConfig.findMany({ where: { schoolId: school.id, key: { in: [...PUBLIC_CONFIG_KEYS] } } });
    const values: Record<string, string> = {};
    for (const r of rows) values[r.key] = r.value;
    return {
      SCHOOL_NAME: school.name,
      APP_NAME: school.appName,
      SCHOOL_SLUG: school.slug,
      HAS_LOGO: school.logoPath ? 'true' : 'false',
      HEADMASTER_NAME: school.headmasterName ?? '',
      HEADMASTER_NIP: school.headmasterNip ?? '',
      ...values,
    };
  }

  /** Sekolah aktif untuk switcher admin. */
  async schools() {
    const rows = await this.prisma.school.findMany({
      where: { isActive: true },
      select: { id: true, slug: true, name: true, appName: true, logoPath: true },
      orderBy: { slug: 'asc' },
    });
    return rows.map(({ logoPath, ...rest }) => ({ ...rest, hasLogo: Boolean(logoPath) }));
  }

  /** Path key branding di DB untuk jenis tertentu (null bila belum diatur). */
  async brandingKey(schoolId: string, kind: BrandingKind) {
    const school = await this.prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) throw new NotFoundException('Sekolah tidak ditemukan');
    return kind === 'logo' ? school.logoPath : kind === 'ttd' ? school.ttdPath : school.stampPath;
  }

  brandingKeyFor(schoolId: string, kind: BrandingKind, ext: string) {
    return `branding/${schoolId}/${kind}.${ext}`;
  }

  async setBranding(schoolId: string, kind: BrandingKind, key: string | null, actorId: string) {
    const field = kind === 'logo' ? 'logoPath' : kind === 'ttd' ? 'ttdPath' : 'stampPath';
    const school = await this.prisma.school.update({ where: { id: schoolId }, data: { [field]: key } });
    await this.audit.log({ actorId, action: 'SCHOOL_BRANDING', entity: 'School', entityId: schoolId, schoolId, meta: { kind, key } });
    return school;
  }

  private assertValue(key: ConfigKey, value: string) {
    const intIn = (min: number, max: number, label: string) => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < min || n > max) {
        throw new BadRequestException(`${label} harus bilangan bulat ${min}–${max}`);
      }
    };
    switch (key) {
      case 'TOKEN_DEFAULT_INTERVAL_SEC':
        intIn(30, 600, 'Interval token');
        break;
      case 'MAX_VIOLATIONS_DEFAULT':
        intIn(0, 20, 'Batas pelanggaran');
        break;
      case 'KKM_DEFAULT':
        intIn(0, 100, 'KKM');
        break;
      case 'REQUIRE_SEB_DEFAULT':
        if (value !== 'true' && value !== 'false') {
          throw new BadRequestException('REQUIRE_SEB_DEFAULT harus "true"/"false"');
        }
        break;
      case 'TAHUN_AJARAN':
        if (!/^\d{4}\/\d{4}$/.test(value)) {
          throw new BadRequestException('Format tahun ajaran: YYYY/YYYY');
        }
        break;
      default:
        if (!value.trim()) throw new BadRequestException('Nilai wajib diisi');
    }
  }

  /** Status PIN keluar APK SEB (TANPA hash). */
  async sebExitPinStatus() {
    const schoolId = this.currentSchoolId();
    const row = await this.prisma.globalConfig.findUnique({
      where: { schoolId_key: { schoolId, key: SEB_EXIT_PIN_KEY } },
      select: { updatedAt: true },
    });
    return { configured: Boolean(row), updatedAt: row?.updatedAt ?? null };
  }

  /** Simpan/ganti PIN keluar APK SEB (disimpan sebagai SHA-256 hex). */
  async setSebExitPin(dto: unknown, actorId: string) {
    const { pin } = sebExitPinSchema.parse(dto);
    const schoolId = this.currentSchoolId();
    await this.prisma.globalConfig.upsert({
      where: { schoolId_key: { schoolId, key: SEB_EXIT_PIN_KEY } },
      update: { value: hashPin(pin) },
      create: { schoolId, key: SEB_EXIT_PIN_KEY, value: hashPin(pin) },
    });
    await this.audit.log({
      actorId,
      action: 'SEB_EXIT_PIN_SET',
      entity: 'GlobalConfig',
      entityId: SEB_EXIT_PIN_KEY,
      schoolId,
      meta: { configured: true }, // jangan pernah catat PIN/hashnya di audit log
    });
    return { ok: true };
  }

  /** Hapus PIN keluar APK SEB (tombol keluar di APK dinonaktifkan). */
  async clearSebExitPin(actorId: string) {
    const schoolId = this.currentSchoolId();
    await this.prisma.globalConfig.deleteMany({ where: { schoolId, key: SEB_EXIT_PIN_KEY } });
    await this.audit.log({
      actorId,
      action: 'SEB_EXIT_PIN_CLEAR',
      entity: 'GlobalConfig',
      entityId: SEB_EXIT_PIN_KEY,
      schoolId,
      meta: {},
    });
    return { ok: true };
  }

  async upsert(dto: ConfigUpsertInput, actorId: string) {
    this.assertValue(dto.key, dto.value);
    if ((dto.key as string) === SEB_EXIT_PIN_KEY) {
      throw new BadRequestException('Gunakan menu PIN Keluar APK SEB — key ini tidak bisa diubah lewat konfigurasi umum.');
    }
    const schoolId = this.currentSchoolId();
    const row = await this.prisma.globalConfig.upsert({
      where: { schoolId_key: { schoolId, key: dto.key } },
      update: { value: dto.value },
      create: { schoolId, key: dto.key, value: dto.value },
    });
    await this.audit.log({ actorId, action: 'CONFIG_UPDATE', entity: 'GlobalConfig', entityId: dto.key, schoolId, meta: { value: dto.value } });
    // Nilai baru langsung berlaku untuk pembaca cache sekolah ini saja.
    this.appConfig.invalidate(schoolId);
    return row;
  }
}
