import { Controller, Get, Inject } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  @Get()
  async check() {
    let db: 'ok' | 'down' = 'down';
    let redis: 'ok' | 'down' = 'down';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'ok';
    } catch {
      // status tetap down
    }

    try {
      const pong = await this.redis.ping();
      if (pong === 'PONG') redis = 'ok';
    } catch {
      // status tetap down
    }

    return {
      status: db === 'ok' && redis === 'ok' ? 'ok' : 'degraded',
      db,
      redis,
      time: new Date().toISOString(),
    };
  }
}
