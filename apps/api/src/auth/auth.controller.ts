import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { changePasswordSchema, loginSchema, refreshRequestSchema, Role, ROLES } from '@cbt/shared';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /** Login generik: POST /api/auth/login — peran dideteksi dari akun (siswa: NISN). */
  @Post('login')
  loginGeneric(@Body() dto: unknown, @Req() req: Request) {
    return this.auth.login(loginSchema.parse(dto), undefined, req.ip);
  }

  /** Login per role: POST /api/auth/login/:role */
  @Post('login/:role')
  login(@Param('role') role: string, @Body() dto: unknown, @Req() req: Request) {
    // Role tak dikenal = 400 langsung (jangan diam-diam jadi login generik
    // yang membocorkan validitas kredensial tanpa cek role).
    if (!(ROLES as readonly string[]).includes(role.toUpperCase())) {
      throw new BadRequestException(`Role tidak dikenal: ${role} (pilih: ${ROLES.join(', ')})`);
    }
    const expected = role.toUpperCase() as Role;
    return this.auth.login(loginSchema.parse(dto), expected, req.ip);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: { sub: string }) {
    return this.auth.me(user.sub);
  }

  /** Tukar refresh token → access token baru (ujian panjang melewati masa hidup token). */
  @Post('refresh')
  refresh(@Body() dto: unknown) {
    return this.auth.refresh(refreshRequestSchema.parse(dto).refreshToken);
  }

  /** Cabut sesi refresh pemanggil (best-effort, selalu ok). */
  @Post('logout')
  logout(@Body() dto: unknown) {
    return this.auth.logout(refreshRequestSchema.parse(dto).refreshToken);
  }

  /** Ganti password mandiri — semua role yang login (Fase 5). */
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  changePassword(@CurrentUser() user: { sub: string }, @Body() dto: unknown) {
    return this.auth.changePassword(user.sub, changePasswordSchema.parse(dto));
  }
}
