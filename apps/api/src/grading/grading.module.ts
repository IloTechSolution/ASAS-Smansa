import { Global, Module } from '@nestjs/common';
import { AnswerReviewController, GradingController } from './grading.controller';
import { GradingService } from './grading.service';

/**
 * Fase 7 — mesin penilaian 5 tipe soal (bobot, all-or-nothing/proporsional),
 * review manual isian singkat, publish hasil, dan analisis butir soal.
 *
 * Modul global seperti MonitoringModule: `GradingService` perlu dipanggil
 * AttemptsService tepat saat attempt dikumpulkan, tanpa ketergantungan melingkar.
 */
@Global()
@Module({
  controllers: [GradingController, AnswerReviewController],
  providers: [GradingService],
  exports: [GradingService],
})
export class GradingModule {}
