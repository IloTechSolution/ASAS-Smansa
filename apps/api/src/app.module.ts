import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AttemptsModule } from './attempts/attempts.module';
import { AuthModule } from './auth/auth.module';
import { AppConfigModule } from './common/config/app-config.module';
import { AuditModule } from './common/audit/audit.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { UploadsModule } from './uploads/uploads.module';
import { ExamCardsModule } from './exam-cards/exam-cards.module';
import { ExamSessionsModule } from './exam-sessions/exam-sessions.module';
import { ExamsModule } from './exams/exams.module';
import { ExportsModule } from './exports/exports.module';
import { GradingModule } from './grading/grading.module';
import { HealthModule } from './health/health.module';
import { KelasModule } from './kelas/kelas.module';
import { MapelModule } from './mapel/mapel.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { PresenceModule } from './presence/presence.module';
import { SebModule } from './seb/seb.module';
import { QuestionsModule } from './questions/questions.module';
import { AttendanceModule } from './attendance/attendance.module';
import { SettingsModule } from './settings/settings.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { IntegrityModule } from './integrity/integrity.module';
import { TokenModule } from './token/token.module';
import { UsersModule } from './users/users.module';
import { TenantInterceptor } from './common/tenant/tenant.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../.env', '../../.env'] }),
    PrismaModule,
    RedisModule,
    AppConfigModule,
    AuditModule,
    HealthModule,
    AuthModule,
    UsersModule,
    KelasModule,
    MapelModule,
    QuestionsModule,
    ExamsModule,
    ExamSessionsModule,
    SettingsModule,
    TokenModule,
    IntegrityModule,
    AnalyticsModule,
    AttendanceModule,
    AttemptsModule,
    MonitoringModule,
    PresenceModule,
    SebModule,
    GradingModule,
    ExamCardsModule,
    ExportsModule,
    UploadsModule,
  ],
  providers: [
    // Setelah guard (req.user tersedia), sebelum handler — semua service
    // membaca konteks sekolah lewat tenant.ts.
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
})
export class AppModule {}
