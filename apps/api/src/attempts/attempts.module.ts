import { Module } from '@nestjs/common';
import { TokenModule } from '../token/token.module';
import { AttemptsController } from './attempts.controller';
import { AttemptsService } from './attempts.service';

// Fase 5: attempt siswa (gate token, timer server-side, autosave Redis, anti-cheat).
@Module({
  imports: [TokenModule],
  controllers: [AttemptsController],
  providers: [AttemptsService],
})
export class AttemptsModule {}
