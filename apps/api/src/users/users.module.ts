import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AppConfigModule } from '../common/config/app-config.module';

@Module({
  controllers: [UsersController],
  imports: [AppConfigModule],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
