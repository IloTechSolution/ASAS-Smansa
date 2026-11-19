import { Module } from '@nestjs/common';
import { KartuCetakController } from './kartu-cetak.controller';
import { KartuCetakService } from './kartu-cetak.service';

@Module({
  controllers: [KartuCetakController],
  providers: [KartuCetakService],
})
export class ExamCardsModule {}
