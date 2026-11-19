import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1, { message: 'Username/NISN wajib diisi' })
  username!: string;

  @IsString()
  @MinLength(1, { message: 'Password wajib diisi' })
  password!: string;
}
