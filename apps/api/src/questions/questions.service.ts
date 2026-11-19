import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { QUESTION_TYPES, QuestionCreateInput, QuestionListQuery, QuestionUpdateInput } from '@cbt/shared';
import { mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { randomBytes } from 'crypto';
import { readFirstSheet } from '../common/excel/excel.helper';
import mammoth from 'mammoth';
import { buildDocxTemplate, buildExcelTemplate } from './question-templates';
import { normalizeDocxKey, parseDocxTables } from './docx-tables';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { UPLOADS_URL_PREFIX, assertImageContent, uploadPathFor, uploadsRoot } from '../common/uploads/upload-files';
import { requireSchoolId, tenantWhere } from '../common/tenant/tenant';

export { UPLOADS_URL_PREFIX, uploadPathFor, uploadsRoot };

/** imageUrl hanya boleh URL hasil unggahan di bawah /uploads/questions/ (atau kosong). */
function assertImageUrl(imageUrl: string | null | undefined) {
  if (imageUrl === null || imageUrl === undefined) return;
  // Terima signed URL juga (query ?exp=&sig=) agar PATCH dari web yang sedang
  // menampilkan gambar tak gagal — yang disimpan tetap path tak bertanda tangan.
  if (!imageUrl.startsWith(UPLOADS_URL_PREFIX) || imageUrl.includes('..') || imageUrl.includes('\\')) {
    throw new BadRequestException('URL gambar tidak valid — unggah lewat endpoint gambar soal');
  }
  // Validasi akhir lewat resolver (menolak traversal yang lolos prefix).
  uploadPathFor(imageUrl);
}

/** Simpan bentuk tak bertanda tangan (tanpa query) ke DB. */
function canonicalImageUrl(imageUrl: string | null | undefined): string | null {
  if (imageUrl === null || imageUrl === undefined) return imageUrl ?? null;
  const q = imageUrl.indexOf('?');
  return q >= 0 ? imageUrl.slice(0, q) : imageUrl;
}


/** Bank soal guru. Guru hanya kelola miliknya; admin boleh semua. */
@Injectable()
export class QuestionsService {
  private readonly logger = new Logger(QuestionsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async owned(id: string, actorId: string, actorRole: string) {
    const q = await this.prisma.question.findFirst({
      where: { id, ...tenantWhere() },
      include: {
        createdBy: { select: { id: true, name: true, username: true } },
        _count: { select: { examLinks: true, answers: true } },
      },
    });
    if (!q || (actorRole !== 'ADMIN' && q.createdById !== actorId)) {
      throw new NotFoundException('Soal tidak ditemukan');
    }
    return q;
  }

  /* ------- cleanup berkas gambar (gambar utama + gambar opsi) ------- */

  /** Kumpulkan semua URL gambar lokal milik sebuah soal (utama + tiap opsi). */
  private collectImageUrls(q: { imageUrl?: string | null; choices?: unknown }): string[] {
    const urls: string[] = [];
    if (typeof q.imageUrl === 'string' && q.imageUrl) urls.push(q.imageUrl);
    if (Array.isArray(q.choices)) {
      for (const c of q.choices) {
        if (c && typeof c === 'object') {
          const u = (c as { imageUrl?: unknown }).imageUrl;
          if (typeof u === 'string' && u) urls.push(u);
        }
      }
    }
    return [...new Set(urls)];
  }

  /** Hitung pemakaian satu URL gambar di seluruh soal (utama + opsi JSON). */
  private async countImageRefs(url: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ c: number }>>`
      SELECT COUNT(*)::int AS c FROM "Question" q
      WHERE q."imageUrl" = ${url}
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(q.choices) = 'array' THEN q.choices ELSE '[]'::jsonb END
           ) AS elem
           WHERE elem ->> 'imageUrl' = ${url}
         )`;
    return rows[0]?.c ?? 0;
  }

  /** Hapus berkas gambar lokal yang sudah 0 referensi. */
  private async unlinkIfUnused(urls: Array<string | null | undefined>) {
    for (const raw of urls) {
      const url = raw ?? '';
      if (!url.startsWith(`${UPLOADS_URL_PREFIX}questions/`)) continue;
      try {
        if ((await this.countImageRefs(url)) === 0) {
          unlinkSync(uploadPathFor(url));
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.logger.warn(`Gagal membersihkan ${url}: ${(e as Error).message}`);
        }
      }
    }
  }

  async list(q: QuestionListQuery, actorId: string, actorRole: string) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const where: Prisma.QuestionWhereInput = { ...tenantWhere() };
    if (actorRole !== 'ADMIN' || q.mine) where.createdById = actorId;
    if (q.type) where.type = q.type;
    if (q.search?.trim()) where.content = { contains: q.search.trim(), mode: 'insensitive' };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.question.count({ where }),
      this.prisma.question.findMany({
        where,
        include: {
          createdBy: { select: { id: true, name: true, username: true } },
          _count: { select: { examLinks: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { data, total, page, limit };
  }

  /** Petakan input union ke kolom Prisma (hanya field relevan per tipe). */
  private toColumns(dto: QuestionCreateInput | QuestionUpdateInput) {
    const base = {
      type: dto.type,
      content: dto.content,
      weight: dto.weight ?? 1,
      scoringMode: dto.scoringMode ?? 'ALL_OR_NOTHING',
      explanation: dto.explanation ?? null,
      choices: Prisma.DbNull,
      correctChoices: Prisma.DbNull,
      pairs: Prisma.DbNull,
      statements: Prisma.DbNull,
      acceptedAnswers: Prisma.DbNull,
    };
    switch (dto.type) {
      case 'PG':
      case 'PG_KOMPLEKS':
        return { ...base, choices: this.canonicalChoices(dto.choices) as unknown as Prisma.InputJsonValue, correctChoices: dto.correctChoices as unknown as Prisma.InputJsonValue };
      case 'MATCHING':
        return { ...base, pairs: dto.pairs as unknown as Prisma.InputJsonValue };
      case 'BENAR_SALAH':
        return { ...base, statements: dto.statements as unknown as Prisma.InputJsonValue };
      case 'ISIAN_SINGKAT':
        return { ...base, acceptedAnswers: dto.acceptedAnswers as unknown as Prisma.InputJsonValue };
    }
  }

  /** Kanonikalisasi imageUrl tiap opsi (buang query signed URL) sebelum disimpan. */
  private canonicalChoices(choices: unknown): unknown {
    if (!Array.isArray(choices)) return choices;
    return choices.map((c) => {
      if (!c || typeof c !== 'object') return c;
      const rec = c as Record<string, unknown>;
      if (typeof rec.imageUrl === 'string') {
        assertImageUrl(rec.imageUrl);
        return { ...rec, imageUrl: canonicalImageUrl(rec.imageUrl) };
      }
      return c;
    });
  }

  async create(dto: QuestionCreateInput, actorId: string) {
    assertImageUrl(dto.imageUrl);
    const schoolId = requireSchoolId();
    const q = await this.prisma.question.create({
      data: { ...this.toColumns(dto), imageUrl: canonicalImageUrl(dto.imageUrl), createdById: actorId, schoolId },
    });
    await this.audit.log({ actorId, action: 'QUESTION_CREATE', entity: 'Question', entityId: q.id, schoolId, meta: { type: q.type } });
    return q;
  }

  detail(id: string, actorId: string, actorRole: string) {
    return this.owned(id, actorId, actorRole);
  }

  async preview(id: string, actorId: string, actorRole: string) {
    const q = await this.owned(id, actorId, actorRole);
    return { ...q, maxScore: q.weight, usageCount: q._count.examLinks };
  }
  async update(id: string, dto: QuestionUpdateInput, actorId: string, actorRole: string) {
    const before = await this.owned(id, actorId, actorRole);
    if (dto.imageUrl !== undefined) assertImageUrl(dto.imageUrl);
    const cols = this.toColumns(dto);
    await this.prisma.question.update({
      where: { id },
      data: { ...cols, imageUrl: dto.imageUrl !== undefined ? canonicalImageUrl(dto.imageUrl) : undefined },
    });
    // Bersihkan berkas yang tidak lagi dipakai (gambar utama yang diganti,
    // gambar opsi yang dihapus/diganti) — refcount ikut menghitung salinan.
    const after = await this.prisma.question.findUnique({ where: { id }, select: { imageUrl: true, choices: true } });
    const removed = this.collectImageUrls(before).filter((u) => !this.collectImageUrls(after ?? {}).includes(u));
    await this.unlinkIfUnused(removed);
    await this.audit.log({ actorId, action: 'QUESTION_UPDATE', entity: 'Question', entityId: id, schoolId: before.schoolId, meta: { type: dto.type } });
    return this.prisma.question.findUnique({ where: { id } });
  }

  async duplicate(id: string, actorId: string, actorRole: string) {
    const src = await this.owned(id, actorId, actorRole);
    // Salinan masuk ke sekolah yang sedang dipilih (bisa lintas sekolah bagi admin).
    const schoolId = requireSchoolId();
    const q = await this.prisma.question.create({
      data: {
        type: src.type,
        content: `${src.content} (salinan)`,
        imageUrl: src.imageUrl,
        weight: src.weight,
        scoringMode: src.scoringMode,
        choices: src.choices ?? Prisma.DbNull,
        correctChoices: src.correctChoices ?? Prisma.DbNull,
        pairs: src.pairs ?? Prisma.DbNull,
        statements: src.statements ?? Prisma.DbNull,
        acceptedAnswers: src.acceptedAnswers ?? Prisma.DbNull,
        explanation: src.explanation,
        createdById: actorId,
        schoolId,
      },
    });
    await this.audit.log({ actorId, action: 'QUESTION_DUPLICATE', entity: 'Question', entityId: q.id, schoolId, meta: { from: id, fromSchool: src.schoolId } });
    return q;
  }

  async remove(id: string, actorId: string, actorRole: string) {
    const q = await this.owned(id, actorId, actorRole);
    if (q._count.examLinks > 0 || q._count.answers > 0) {
      throw new ConflictException(
        `Soal dipakai ${q._count.examLinks} ujian / ${q._count.answers} jawaban — tidak bisa dihapus`,
      );
    }
    const oldImageUrls = this.collectImageUrls(q);
    await this.prisma.question.delete({ where: { id } });
    if (oldImageUrls.length) {
      await this.unlinkIfUnused(oldImageUrls);
    }
    await this.audit.log({ actorId, action: 'QUESTION_DELETE', entity: 'Question', entityId: id, schoolId: q.schoolId, meta: { type: q.type } });
    return { ok: true };
  }

  /** Simpan gambar soal ke UPLOAD_DIR/questions, kembalikan URL publik. */
  async attachImage(id: string, file: { buffer: Buffer; originalname: string }, actorId: string, actorRole: string) {
    const q = await this.owned(id, actorId, actorRole);
    const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
    if (!['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
      throw new BadRequestException('Gambar harus .jpg/.png/.webp/.gif');
    }
    // Ekstensi saja tak cukup — pastikan isi byte benar-benar gambar (P4).
    assertImageContent(file.buffer, ext);
    const dir = resolve(uploadsRoot(), 'questions');
    mkdirSync(dir, { recursive: true });
    const filename = `q_${id}_${Date.now()}.${ext}`;
    writeFileSync(resolve(dir, filename), file.buffer);
    const imageUrl = `/uploads/questions/${filename}`;
    const updated = await this.prisma.question.update({ where: { id }, data: { imageUrl } });
    await this.unlinkIfUnused([q.imageUrl]);
    await this.audit.log({ actorId, action: 'QUESTION_IMAGE', entity: 'Question', entityId: id, schoolId: q.schoolId });
    return { imageUrl: updated.imageUrl };
  }

  /** Export CSV bank soal (guru: milik sendiri; admin: semua, bisa difilter). */
  async exportCsv(q: QuestionListQuery, actorId: string, actorRole: string): Promise<Buffer> {
    const where: Prisma.QuestionWhereInput = { ...tenantWhere() };
    if (actorRole !== 'ADMIN' || q.mine) where.createdById = actorId;
    if (q.type) where.type = q.type;
    if (q.search?.trim()) where.content = { contains: q.search.trim(), mode: 'insensitive' };
    const rows = await this.prisma.question.findMany({
      where,
      select: { id: true, type: true, weight: true, content: true },
      orderBy: { updatedAt: 'desc' },
    });
    const esc = (v: unknown) => {
      let t = String(v ?? '');
      // Cegah formula injection saat dibuka di Excel (konsisten dengan ExportService.safeCell).
      if (/^[=+\-@]/.test(t.trimStart())) t = `'${t}`;
      return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    const lines = ['id,tipe,bobot,konten'];
    for (const r of rows) {
      lines.push([esc(r.id), esc(r.type), esc(r.weight), esc(r.content)].join(','));
    }
    return Buffer.from('﻿' + lines.join('\r\n'), 'utf8');
  }

  /* --------------------------- import Excel & DOCX --------------------------- */

  /** Template Excel import soal (sheet Soal + Petunjuk; contoh 5 tipe). */
  async buildImportTemplate(): Promise<Buffer> {
    return buildExcelTemplate();
  }

  /** Template Word (DOCX) import soal — format sederhana blok "SOAL <n>". */
  async buildDocxImportTemplate(): Promise<Buffer> {
    return buildDocxTemplate();
  }

  /** Import bulk soal dari buffer Excel. Sheet pertama, header bilingual (Tipe/Type dkk).
   *  Per baris independen: sukses dicatat, gagal dilaporkan (tidak menggagalkan semua).
   */
  async importExcel(buffer: Buffer, actorId: string) {
    const schoolId = requireSchoolId();
    let rows: Array<Record<string, string>> | null;
    try {
      rows = await readFirstSheet(buffer);
    } catch {
      throw new BadRequestException('File Excel tidak valid');
    }
    if (rows === null) throw new BadRequestException('File Excel kosong');
    if (rows.length === 0) throw new BadRequestException('Tidak ada baris data');
    if (rows.length > 500) throw new BadRequestException('Maksimal 500 soal per import');
    return this.runImport(rows, actorId, schoolId, (i) => String(i + 2));
  }

  /** Import bulk soal dari DOCX: tabel "Label | Isian" (template baru) atau blok "SOAL <n>" (format lama). */
  async importDocx(buffer: Buffer, actorId: string) {
    const schoolId = requireSchoolId();
    let rows: Array<Record<string, unknown>>;
    try {
      const html = (await mammoth.convertToHtml({ buffer })).value;
      rows = parseDocxTables(html);
      if (rows.length === 0) {
        const text = (await mammoth.extractRawText({ buffer })).value;
        rows = this.parseDocxQuestions(text);
      }
    } catch {
      throw new BadRequestException('File DOCX tidak valid');
    }
    if (rows.length === 0) {
      throw new BadRequestException('Dokumen tidak berisi tabel soal atau baris "SOAL <nomor>" — lihat contoh pada template DOCX');
    }
    if (rows.length > 500) throw new BadRequestException('Maksimal 500 soal per import');
    return this.runImport(rows, actorId, schoolId, (i) => String(rows[i].__row ?? `SOAL ${i + 1}`));
  }

  /** Jalankan impor dari baris generik — dipakai bersama oleh Excel & DOCX. Per baris independen. */
  private async runImport(
    rows: Array<Record<string, unknown>>,
    actorId: string,
    schoolId: string,
    label: (i: number) => string,
  ) {
    const success: Array<{ row: string; id: string }> = [];
    const failed: Array<{ row: string; error: string }> = [];
    for (let i = 0; i < rows.length; i++) {
      try {
        const dto = this.parseImportRow(rows[i]);
        const q = await this.create(dto as QuestionCreateInput, actorId);
        success.push({ row: label(i), id: q.id });
      } catch (e) {
        const msg =
          e instanceof BadRequestException || e instanceof ConflictException
            ? e.message
            : 'Gagal memproses baris';
        failed.push({ row: label(i), error: msg });
      }
    }
    await this.audit.log({
      actorId,
      action: 'QUESTION_IMPORT',
      entity: 'Question',
      schoolId,
      meta: { total: rows.length, success: success.length, failed: failed.length },
    });
    return { total: rows.length, success, failed };
  }

  /** Parser sederhana: pecah teks DOCX menjadi blok "SOAL <n>" lalu pasangan "Kunci: nilai" per baris. */
  private parseDocxQuestions(text: string): Array<Record<string, unknown>> {
    const lines = text.split(/\r?\n/).map((l) => l.replace(/\t/g, ' ').trim());
    const blocks: Array<{ label: string; kv: Record<string, string> }> = [];
    let current: { label: string; kv: Record<string, string> } | null = null;
    let currentKey: string | null = null;
    for (const raw of lines) {
      if (!raw.trim()) continue;
      const line = raw.trim();
      const mSoal = line.match(/^SOAL\s*[:.#-]?\s*(\d+)?\s*$/i);
      if (mSoal) {
        if (current) blocks.push(current);
        current = { label: `SOAL ${mSoal[1] ?? blocks.length + 1}`, kv: {} };
        currentKey = null;
        continue;
      }
      if (!current) continue; // teks sebelum blok pertama diabaikan (judul/petunjuk)
      const m = line.match(/^([A-Za-z][A-Za-z ]{0,29})\s*:\s*(.*)$/);
      if (m) {
        const key = normalizeDocxKey(m[1]);
        current.kv[key] = m[2].trim();
        currentKey = key;
      } else if (currentKey === 'Konten' || currentKey === 'Pembahasan') {
        // lanjutan konten multi-baris (wrap) — hanya untuk teks bebas;
        // baris lain yang tidak dikenali diabaikan agar tidak meracuni nilai terstruktur.
        current.kv[currentKey] = `${current.kv[currentKey]} ${line}`.trim();
      }
    }
    if (current) blocks.push(current);
    return blocks.map((b) => ({ ...b.kv, __row: b.label }));
  }

  /** Ubah sel Excel baris import menjadi DTO questionCreate (divalidasi Zod di create via questionCreateSchema). */
  private parseImportRow(r: Record<string, unknown>) {
    const cell = (k: string) => String(r[k] ?? '').trim();
    const typeRaw = (cell('Tipe') || cell('Type') || cell('type') || cell('tipe')).toUpperCase();
    if (!(QUESTION_TYPES as readonly string[]).includes(typeRaw)) {
      throw new BadRequestException(`Tipe "${typeRaw}" tidak dikenal (PG/PG_KOMPLEKS/MATCHING/BENAR_SALAH/ISIAN_SINGKAT)`);
    }
    const weightRaw = cell('Bobot') || cell('Weight') || cell('weight');
    const weight = weightRaw ? Number(String(weightRaw).replace(',', '.')) : 1;
    if (!Number.isFinite(weight)) throw new BadRequestException('Bobot harus berupa angka (0,5–100)');
    const modeRaw = (cell('Mode Skor') || cell('ScoringMode') || cell('scoringMode') || 'ALL_OR_NOTHING').toUpperCase().replace(/\s+/g, '_');
    const scoringMode = modeRaw === 'PROPORSIONAL' ? 'PROPORSIONAL' : 'ALL_OR_NOTHING';
    const content = cell('Konten') || cell('Content') || cell('content') || cell('Soal') || cell('soal');
    const explanation = cell('Pembahasan') || cell('Explanation') || cell('explanation');
    if (!content) throw new BadRequestException('Teks soal (Konten) wajib diisi');

    switch (typeRaw) {
      case 'PG':
      case 'PG_KOMPLEKS': {
        const raw = cell('Opsi') || cell('Choices') || cell('choices');
        const choices = raw ? raw.split(';').map((p) => {
          const [id, label] = p.split('|').map((s) => s.trim());
          return id && label ? { id, label } : null;
        }).filter(Boolean) as Array<{ id: string; label: string }> : [];
        if (choices.length < 2) throw new BadRequestException('Opsi PG wajib minimal 2 (format "ID|teks;ID|teks")');
        const keys = this.splitKeys(cell('Kunci') || cell('CorrectChoices') || cell('correctChoices') || cell('Kunci Pilihan'));
        if (!keys.length) throw new BadRequestException('Kunci PG wajib diisi (salah satu ID opsi)');
        return { type: typeRaw, content, weight, scoringMode, explanation: explanation || null, choices, correctChoices: keys };
      }
      case 'ISIAN_SINGKAT': {
        const keys = this.splitKeys(cell('KunciIsian') || cell('Kunci') || cell('AcceptedAnswers') || cell('acceptedAnswers') || cell('Kunci Pilihan'));
        if (!keys.length) throw new BadRequestException('Kunci isian singkat wajib diisi');
        return { type: typeRaw, content, weight: weightRaw ? weight : 1, scoringMode: 'ALL_OR_NOTHING', explanation: explanation || null, acceptedAnswers: keys };
      }
      case 'BENAR_SALAH': {
        const raw = cell('Pernyataan') || cell('Statements') || cell('statements');
        const statements = raw ? raw.split(';').map((p, idx) => {
          const [text, ans] = p.split('|').map((s) => s.trim());
          if (!text || !ans) return null;
          const a = ans.toUpperCase();
          if (!['B', 'BENAR', 'S', 'SALAH', 'TRUE', 'FALSE'].includes(a)) return null;
          const v = ['B', 'BENAR', 'TRUE'].includes(a);
          return { id: `s${idx + 1}`, text, answer: v };
        }).filter(Boolean) as Array<{ id: string; text: string; answer: boolean }> : [];
        if (!statements.length) throw new BadRequestException('Pernyataan BENAR_SALAH wajib (format "teks|B/S;…")');
        return { type: typeRaw, content, weight, scoringMode, explanation: explanation || null, statements };
      }
      case 'MATCHING': {
        const kiriRaw = cell('Kiri') || cell('Left') || cell('left');
        const kananRaw = cell('Kanan') || cell('Right') || cell('right');
        const splitSide = (raw: string) =>
          raw.split(';').flatMap((part) =>
            part.split('|').map((p) => p.trim()).filter(Boolean),
          );
        const left = splitSide(kiriRaw).map((text, idx) => ({ id: `l${idx + 1}`, text }));
        const right = splitSide(kananRaw).map((text, idx) => ({ id: `r${idx + 1}`, text }));
        if (left.length < 2 || right.length < 2) throw new BadRequestException('Matching wajib minimal 2 kiri & 2 kanan (pisah dengan ; atau |)');
        const mapping: Record<string, string> = {};
        left.forEach((l, idx) => { mapping[l.id] = right[idx]?.id ?? right[0]?.id ?? ''; });
        return { type: typeRaw, content, weight, scoringMode, explanation: explanation || null, pairs: { left, right, mapping } };
      }
      default:
        throw new BadRequestException(`Tipe "${typeRaw}" tidak dikenal (PG/PG_KOMPLEKS/MATCHING/BENAR_SALAH/ISIAN_SINGKAT)`);
    }
  }

  private splitKeys(raw: string): string[] {
    return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  }

  /**
   * Unggah gambar bebas — dipakai editor untuk gambar pada opsi jawaban
   * (gambar bisa dipasang sebelum soal tersimpan). Berkas dibersihkan mengikuti
   * soal yang memakainya (lihat collectImageUrls/unlinkIfUnused).
   */
  async uploadFree(file: { buffer: Buffer; originalname: string }, actorId: string) {
    const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
    if (!['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
      throw new BadRequestException('Gambar harus .jpg/.png/.webp/.gif');
    }
    assertImageContent(file.buffer, ext);
    const dir = resolve(uploadsRoot(), 'questions');
    mkdirSync(dir, { recursive: true });
    const filename = `qi_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}.${ext}`;
    writeFileSync(resolve(dir, filename), file.buffer);
    const imageUrl = `/uploads/questions/${filename}`;
    await this.audit.log({ actorId, action: 'IMAGE_UPLOAD', entity: 'Upload', entityId: filename });
    return { imageUrl };
  }
}
