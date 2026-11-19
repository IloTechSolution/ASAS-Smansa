import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

// Fase 4: export hasil ujian (Excel) — membutuhkan AttendanceService.
@Module({
  imports: [AttendanceModule],
  controllers: [ExportController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportsModule {}
