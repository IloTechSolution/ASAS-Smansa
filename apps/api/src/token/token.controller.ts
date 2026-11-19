import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { JwtPayload, tokenReleaseSchema, tokenVerifySchema } from '@cbt/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TokenService } from './token.service';

/** Token sesi: panel proktor + gerbang siswa. */
@Controller('sessions/:id/token')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TokenController {
  constructor(@Inject(TokenService) private readonly token: TokenService) {}

  @Get('current')
  @Roles('PROKTOR', 'ADMIN')
  current(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.token.current(id, actor.sub, actor.role);
  }

  @Post('release')
  @Roles('PROKTOR', 'ADMIN')
  release(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    const parsed = tokenReleaseSchema.parse(dto ?? {});
    return this.token.release(id, actor.sub, parsed.note, actor.role);
  }

  /** Tanpa batas role — dipakai gerbang ruang ujian siswa. */
  @Post('verify')
  @Roles('SISWA', 'PROKTOR', 'ADMIN', 'GURU')
  verify(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.token.verify(id, tokenVerifySchema.parse(dto).token, actor.sub);
  }
}
