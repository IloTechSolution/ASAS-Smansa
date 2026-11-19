import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdirSync } from 'fs';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ZodExceptionFilter } from './common/filters/zod-exception.filter';
import { uploadsRoot } from './common/uploads/upload-files';

async function bootstrap() {
  // Fail fast: JWT_SECRET kosong/pendek tidak boleh lolos sampai request pertama.
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET belum diisi / kurang dari 32 karakter — set di .env (lihat .env.example).');
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Percayai X-Forwarded-* hanya dari proxy privat (nginx/Docker). Tanpa ini
  // req.ip selalu IP proxy sehingga throttle login per-IP tidak berguna;
  // dengan ini, header palsu dari internet tidak dipercaya.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(','),
    credentials: true,
  });
  // Rute penyajian gambar dikecualikan dari prefix /api — <img src> tidak
  // bisa mengirim header, sehingga binary dilayani lewat path yang sama
  // dengan proxy /uploads yang sudah ada (nginx & vite).
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'uploads/questions/:filename', method: RequestMethod.GET }],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Validasi Zod di controller (kebal tsx/esbuild yang tak emit decorator metadata).
  app.useGlobalFilters(new ZodExceptionFilter());
  // Graceful shutdown: tutup koneksi Prisma/Redis saat SIGTERM/SIGINT (docker stop).
  app.enableShutdownHooks();

  // Berkas unggahan TIDAK lagi dilayani statis publik — hanya lewat
  // /uploads/questions/:filename dengan signature HMAC (lihat UploadsController).
  const uploadDir = uploadsRoot();
  mkdirSync(`${uploadDir}/questions`, { recursive: true });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  new Logger('Bootstrap').log(`CBT API listening on http://localhost:${port}/api`);
}
bootstrap();
