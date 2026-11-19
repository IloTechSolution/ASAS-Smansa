import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigKey } from '@cbt/shared';
import { PrismaService } from '../prisma/prisma.service';

const CACHE_TTL_MS = 30_000;

/**
 * Pembaca konfigurasi per sekolah (tabel GlobalConfig, PK komposit schoolId+key)
 * dengan cache singkat per sekolah. Branding sekolah (nama/appName/kepala
 * sekolah) hidup di tabel School — bukan di sini.
 * Menulis tetap lewat SettingsService (ADMIN) yang mengaudit setiap perubahan.
 */
@Injectable()
export class AppConfigService {
  private readonly logger = new Logger(AppConfigService.name);
  private caches = new Map<string, { at: number; values: Map<string, string> }>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async load(schoolId: string): Promise<Map<string, string>> {
    const hit = this.caches.get(schoolId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return hit.values;
    }
    try {
      const rows = await this.prisma.globalConfig.findMany({ where: { schoolId } });
      this.caches.set(schoolId, { at: Date.now(), values: new Map(rows.map((r) => [r.key, r.value])) });
    } catch (e) {
      // Konfigurasi bersifat penyempurnaan — bila DB error, pakai cache lama / default.
      this.logger.warn(`Gagal membaca GlobalConfig: ${(e as Error).message}`);
      this.caches.set(schoolId, hit ?? { at: Date.now(), values: new Map() });
    }
    return this.caches.get(schoolId)!.values;
  }

  /** Bersihkan cache — dipanggil SettingsService setelah upsert agar nilai baru langsung berlaku. */
  invalidate(schoolId?: string) {
    if (schoolId) this.caches.delete(schoolId);
    else this.caches.clear();
  }

  async getString(key: ConfigKey, fallback: string, schoolId: string): Promise<string> {
    const values = await this.load(schoolId);
    const v = values.get(key);
    return v !== undefined && v.trim() !== '' ? v : fallback;
  }

  async getInt(key: ConfigKey, fallback: number, schoolId: string): Promise<number> {
    const raw = await this.getString(key, String(fallback), schoolId);
    const n = Number(raw);
    return Number.isFinite(n) ? Math.round(n) : fallback;
  }

  async getFloat(key: ConfigKey, fallback: number, schoolId: string): Promise<number> {
    const raw = await this.getString(key, String(fallback), schoolId);
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  async getBool(key: ConfigKey, fallback: boolean, schoolId: string): Promise<boolean> {
    const raw = (await this.getString(key, fallback ? 'true' : 'false', schoolId)).trim().toLowerCase();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return fallback;
  }
}
