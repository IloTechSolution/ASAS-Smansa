import { Module } from '@nestjs/common';
import { GlobalIntegrityController, IntegrityController } from './integrity.controller';
import { IntegrityService } from './integrity.service';
@Module({ controllers: [IntegrityController, GlobalIntegrityController], providers: [IntegrityService], exports: [IntegrityService] })
export class IntegrityModule {}
