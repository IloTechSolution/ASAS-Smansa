import { Global, Module } from '@nestjs/common';
import { AppConfigService } from './app-config.service';

/**
 * Konfigurasi sekolah (GlobalConfig) tersedia di mana pun tanpa import modul.
 * Baca-Tulis tetap lewat /settings (ADMIN) — ini hanya pembaca dengan cache.
 */
@Global()
@Module({
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
