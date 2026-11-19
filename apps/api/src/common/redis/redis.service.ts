import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/** Client Redis bersama (dipakai untuk buffer autosave, timer, rate-limit). */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(@Inject(ConfigService) config: ConfigService) {
    super(config.get<string>('REDIS_URL') ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });
  }

  async onModuleDestroy() {
    try {
      this.disconnect();
    } catch {
      // abaikan saat shutdown
    }
  }
}
