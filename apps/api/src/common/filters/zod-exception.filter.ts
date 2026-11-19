import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { ZodError } from 'zod';

/** Ubah ZodError dari validasi controller menjadi respons 400 yang rapi. */
@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(ex: ZodError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const shown = ex.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'input'}: ${i.message}`);
    const sisa = ex.issues.length - shown.length;
    const message = (shown.join('; ') || 'Validasi gagal') + (sisa > 0 ? `; dan ${sisa} kesalahan lain` : '');
    res.status(400).json({ statusCode: 400, message, error: 'Bad Request' });
  }
}
