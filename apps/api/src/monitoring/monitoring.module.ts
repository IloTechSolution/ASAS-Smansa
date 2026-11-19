import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { AttemptControlController, MonitoringController } from './monitoring.controller';
import { MonitoringGateway } from './monitoring.gateway';
import { MonitoringService } from './monitoring.service';

/**
 * Fase 6 — monitoring realtime + kendali attempt.
 * Modul global: `MonitoringGateway` bisa disuntik ke mana pun (mis. AttemptsService)
 * tanpa memicu ketergantungan melingkar.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: (config.get<string>('JWT_EXPIRES_IN') ?? '15m') as StringValue },
      }),
    }),
  ],
  controllers: [MonitoringController, AttemptControlController],
  providers: [MonitoringGateway, MonitoringService],
  exports: [MonitoringGateway, MonitoringService],
})
export class MonitoringModule {}
