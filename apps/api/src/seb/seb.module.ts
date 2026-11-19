import { Module } from '@nestjs/common';
import { SebController } from './seb.controller';

@Module({
  controllers: [SebController],
})
export class SebModule {}
