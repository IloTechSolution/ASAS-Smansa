import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtPayload, questionCreateSchema, questionListQuerySchema, questionUpdateSchema } from '@cbt/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { QuestionsService } from './questions.service';

/** Maksimal ukuran gambar soal (selaras UPLOAD_MAX_MB default). */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;



/**
 * Bank soal — GURU (milik sendiri) & ADMIN (semua).
 * Validasi via Zod (@cbt/shared).
 */
@Controller('questions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('GURU', 'ADMIN')
export class QuestionsController {
  constructor(@Inject(QuestionsService) private readonly questions: QuestionsService) {}

  @Get()
  list(@Query() q: Record<string, unknown>, @CurrentUser() actor: JwtPayload) {
    return this.questions.list(questionListQuerySchema.parse(q), actor.sub, actor.role);
  }

  @Post()
  create(@Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.questions.create(questionCreateSchema.parse(dto), actor.sub);
  }

  /** Unduh template Excel import soal (sheet Soal + Petunjuk, contoh 5 tipe). */
  @Get('import/template')
  async template() {
    const buf = await this.questions.buildImportTemplate();
    return new StreamableFile(buf, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="template-import-soal.xlsx"',
    });
  }

  /** Unduh template Word (DOCX) import soal — format sederhana, bisa diisi di Word. */
  @Get('import/template-docx')
  async templateDocx() {
    const buf = await this.questions.buildDocxImportTemplate();
    return new StreamableFile(buf, {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      disposition: 'attachment; filename="template-import-soal.docx"',
    });
  }

  /** Import bulk soal dari berkas Excel (.xlsx) atau Word (.docx) — field `file`. */
  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        const ok = /\.(xlsx|docx)$/i.test(file.originalname);
        if (!ok) return cb(new BadRequestException('File harus .xlsx atau .docx'), false);
        cb(null, true);
      },
    }),
  )
  import(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() actor: JwtPayload) {
    if (!file?.buffer?.length) throw new BadRequestException('File import wajib dilampirkan (field `file`)');
    const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
    return ext === 'docx'
      ? this.questions.importDocx(file.buffer, actor.sub)
      : this.questions.importExcel(file.buffer, actor.sub);
  }

  /** Unduh seluruh bank soal (CSV) — untuk dipindahkan ke ujian via import. */
  @Get('export')
  async exportCsv(@Query() q: Record<string, unknown>, @CurrentUser() actor: JwtPayload) {
    const buf = await this.questions.exportCsv(questionListQuerySchema.parse(q), actor.sub, actor.role);
    return new StreamableFile(buf, {
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="bank-soal.csv"',
    });
  }

  @Get(':id')
  detail(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.questions.detail(id, actor.sub, actor.role);
  }

  @Get(':id/preview')
  preview(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.questions.preview(id, actor.sub, actor.role);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: unknown, @CurrentUser() actor: JwtPayload) {
    return this.questions.update(id, questionUpdateSchema.parse(dto), actor.sub, actor.role);
  }

  @Post(':id/duplicate')
  duplicate(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.questions.duplicate(id, actor.sub, actor.role);
  }

  /** Unggah gambar bebas (dipakai editor opsi gambar; tanpa perlu soal tersimpan). */
  @Post('image')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        const ok = /\.(jpe?g|png|webp|gif)$/i.test(file.originalname);
        if (!ok) return cb(new BadRequestException('Gambar harus .jpg/.png/.webp/.gif'), false);
        cb(null, true);
      },
    }),
  )
  uploadFree(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() actor: JwtPayload) {
    if (!file?.buffer?.length) throw new BadRequestException('File gambar wajib dilampirkan (field `image`)');
    return this.questions.uploadFree(file, actor.sub);
  }

  /** Unggah gambar soal (terikat soal yang ada). */
  @Post(':id/image')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        const ok = /\.(jpe?g|png|webp|gif)$/i.test(file.originalname);
        if (!ok) return cb(new BadRequestException('Gambar harus .jpg/.png/.webp/.gif'), false);
        cb(null, true);
      },
    }),
  )
  image(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() actor: JwtPayload,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('File gambar wajib dilampirkan (field `image`)');
    return this.questions.attachImage(id, file, actor.sub, actor.role);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.questions.remove(id, actor.sub, actor.role);
  }
}
