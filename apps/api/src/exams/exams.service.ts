import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ExamCandidatesQuery, ExamCreateInput, ExamEnrollInput, ExamListQuery, ExamQuestionsSetInput, ExamUpdateInput } from '@cbt/shared';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { effectiveCorrect, gradeQuestion, isBlank } from '../grading/grading.service';
import { requireSchoolId, tenantWhere } from '../common/tenant/tenant';

const r2 = (n: number) => Math.round(n * 100) / 100;
const asStrArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** Builder ujian. Guru hanya kelola miliknya; admin boleh semua. */
@Injectable()
export class ExamsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Baca ujian: admin bebas, pemilik, PROKTOR (pelaksanaan), atau guru mana pun
   * bila ujian dibuat oleh ADMIN (ujian sekolah dibagikan ke semua guru).
   */
  private async owned(id: string, actorId: string, actorRole: string) {
    const exam = await this.prisma.exam.findFirst({
      where: { id, ...tenantWhere() },
      include: {
        mapel: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, name: true, username: true, role: true } },
        _count: { select: { sessions: true, questions: true } },
      },
    });
    const isAdminExam = exam?.createdBy?.role === 'ADMIN';
    const allowed =
      actorRole === 'ADMIN' ||
      actorRole === 'PROKTOR' ||
      exam?.createdById === actorId ||
      (actorRole === 'GURU' && isAdminExam);
    if (!exam || !allowed) {
      throw new NotFoundException('Ujian tidak ditemukan');
    }
    return exam;
  }

  /** Ubah/hapus/susun soal: hanya admin atau pemilik — ujian admin TIDAK ikut terbuka. */
  private async ownedWrite(id: string, actorId: string, actorRole: string) {
    const exam = await this.prisma.exam.findFirst({ where: { id, ...tenantWhere() }, select: { id: true, createdById: true, schoolId: true } });
    if (!exam || (actorRole !== 'ADMIN' && exam.createdById !== actorId)) {
      throw new NotFoundException('Ujian tidak ditemukan');
    }
    return exam;
  }

  /** Kelola enrol peserta: admin, proktor (pelaksanaan), pemilik, atau guru untuk ujian admin. */
  private async examOrThrowManage(id: string, actorId: string, actorRole: string) {
    const exam = await this.prisma.exam.findFirst({
      where: { id, ...tenantWhere() },
      include: { createdBy: { select: { role: true } } },
    });
    if (!exam) throw new NotFoundException('Ujian tidak ditemukan');
    const isAdminExam = exam.createdBy?.role === 'ADMIN';
    const allowed =
      actorRole === 'ADMIN' || actorRole === 'PROKTOR' || exam.createdById === actorId || (actorRole === 'GURU' && isAdminExam);
    if (!allowed) {
      throw new ForbiddenException('Anda tidak berhak mengelola peserta ujian ini');
    }
    return exam;
  }

  async list(q: ExamListQuery, actorId: string, actorRole: string) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const scope: Prisma.ExamWhereInput = (() => {
      if (actorRole === 'ADMIN') {
        return q.mine ? { createdById: actorId } : {};
      }
      if (actorRole === 'GURU') {
        // Ujian buatan ADMIN muncul untuk semua guru (di samping miliknya sendiri), per sekolah.
        return { OR: [{ createdById: actorId }, { createdBy: { role: 'ADMIN' } }] };
      }
      return { createdById: actorId };
    })();
    const where: Prisma.ExamWhereInput = {
      AND: [
        scope,
        tenantWhere(),
        ...(q.mapelId ? [{ mapelId: q.mapelId }] : []),
        ...(q.search?.trim() ? [{ title: { contains: q.search.trim(), mode: 'insensitive' as const } }] : []),
      ],
    };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.exam.count({ where }),
      this.prisma.exam.findMany({
        where,
        include: {
          mapel: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, name: true } },
          _count: { select: { sessions: true, questions: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { data, total, page, limit };
  }

  async create(dto: ExamCreateInput, actorId: string) {
    const schoolId = requireSchoolId();
    const mapel = await this.prisma.mapel.findFirst({ where: { id: dto.mapelId, schoolId } });
    if (!mapel) throw new BadRequestException('Mapel tidak ditemukan di sekolah ini');
    const exam = await this.prisma.exam.create({
      data: {
        title: dto.title,
        description: dto.description ?? null,
        mapelId: dto.mapelId,
        createdById: actorId,
        schoolId,
      },
    });
    await this.audit.log({ actorId, action: 'EXAM_CREATE', entity: 'Exam', entityId: exam.id, schoolId, meta: { title: exam.title } });
    return exam;
  }

  async detail(id: string, actorId: string, actorRole: string) {
    const exam = await this.owned(id, actorId, actorRole);
    const links = await this.prisma.examQuestion.findMany({
      where: { examId: id },
      include: { question: { select: { id: true, type: true, content: true, weight: true, imageUrl: true } } },
      orderBy: { order: 'asc' },
    });
    const totalWeight = links.reduce((s, l) => s + l.question.weight, 0);
    return { ...exam, questions: links.map((l) => ({ order: l.order, ...l.question })), totalWeight };
  }

  /**
   * Pratinjau lengkap untuk ditinjau guru (BERKUNCI): soal sesuai urutan ujian,
   * statistik agregat dari seluruh sesi yang sudah selesai, dan pemakaian ulang.
   * Hanya GURU/ADMIN — dikunci controller (PROKTOR & SISWA 403).
   */
  async preview(id: string, actorId: string, actorRole: string) {
    const exam = await this.owned(id, actorId, actorRole);
    const links = await this.prisma.examQuestion.findMany({
      where: { examId: id },
      include: { question: true },
      orderBy: { order: 'asc' },
    });
    const questionIds = links.map((l) => l.questionId);

    const [usage, attempts] = await Promise.all([
      questionIds.length
        ? this.prisma.examQuestion.groupBy({
            by: ['questionId'],
            where: { questionId: { in: questionIds } },
            _count: { questionId: true },
          })
        : Promise.resolve([]),
      this.prisma.attempt.findMany({
        where: { session: { examId: id }, status: { not: 'IN_PROGRESS' } },
        include: { answers: true },
      }),
    ]);
    const usageById = new Map(usage.map((u) => [u.questionId, u._count.questionId]));

    // Daya pembeda memakai ranking peserta gabungan seluruh sesi ujian (27% atas vs bawah).
    const ranked = attempts
      .map((a) => ({
        score: a.score ?? 0,
        answers: new Map(a.answers.map((x) => [x.questionId, x])),
      }))
      .sort((x, y) => y.score - x.score);
    const groupSize = Math.max(1, Math.round(ranked.length * 0.27));
    const upper = ranked.length >= 4 ? ranked.slice(0, groupSize) : [];
    const lower = ranked.length >= 4 ? ranked.slice(-groupSize) : [];

    const questions = links.map((link, i) => {
      const q = link.question;
      const weight = r2(Number(q.weight) || 0);
      let answered = 0;
      let blank = 0;
      let hits = 0;
      let earned = 0;
      let attempted = 0;
      for (const a of attempts) {
        const ans = a.answers.find((x) => x.questionId === q.id);
        if (ans) answered += 1;
        if (!ans || isBlank(q, ans.payload)) {
          blank += 1;
          continue;
        }
        attempted += 1;
        const verdict = gradeQuestion(q, ans.payload);
        if (effectiveCorrect(verdict, ans.reviewedScore) === true) hits += 1;
        earned += ans.reviewedScore ?? verdict.score;
      }

      const stats =
        attempts.length > 0
          ? (() => {
              const p = attempted > 0 ? hits / attempted : 0;
              const correctIn = (group: typeof ranked) =>
                group.reduce((sum, a) => {
                  const ans = a.answers.get(q.id);
                  if (!ans) return sum;
                  const verdict = gradeQuestion(q, ans.payload);
                  return sum + (effectiveCorrect(verdict, ans.reviewedScore) === true ? 1 : 0);
                }, 0);
              const discrimination =
                upper.length && lower.length
                  ? r2((correctIn(upper) - correctIn(lower)) / upper.length)
                  : null;
              const level = p >= 0.7 ? 'MUDAH' : p >= 0.3 ? 'SEDANG' : 'SULIT';
              const discriminationLabel =
                discrimination === null
                  ? 'BELUM_CUKUP_DATA'
                  : discrimination >= 0.4
                    ? 'BAIK'
                    : discrimination >= 0.2
                      ? 'CUKUP'
                      : discrimination >= 0
                        ? 'LEMAH'
                        : 'BURUK';
              return {
                attempts: attempts.length,
                answered,
                blank,
                correct: hits,
                /** Tingkat kesulitan 0..1: makin tinggi makin mudah. */
                difficulty: r2(p),
                difficultyLabel: level,
                /** Daya pembeda (D): ≥0,4 baik; <0,2 perlu diperbaiki. */
                discrimination,
                discriminationLabel,
                avgPercent: weight > 0 && attempted > 0 ? r2((earned / attempted / weight) * 100) : 0,
              };
            })()
          : null;

      const base = {
        order: i + 1,
        id: q.id,
        type: q.type,
        content: q.content,
        imageUrl: q.imageUrl,
        weight,
        scoringMode: q.scoringMode,
        explanation: q.explanation,
        usageCount: usageById.get(q.id) ?? 0,
        mine: q.createdById === actorId,
        stats,
      };
      if (q.type === 'PG' || q.type === 'PG_KOMPLEKS') {
        const correct = asStrArr(q.correctChoices);
        const choices = (Array.isArray(q.choices) ? q.choices : []) as Array<{
          id?: unknown;
          label?: unknown;
          imageUrl?: unknown;
        }>;
        return {
          ...base,
          choices: choices.map((c) => ({
            id: String(c.id ?? ''),
            label: String(c.label ?? ''),
            imageUrl: typeof c.imageUrl === 'string' ? c.imageUrl : null,
            isKey: correct.includes(String(c.id ?? '')),
          })),
        };
      }
      if (q.type === 'MATCHING') {
        const pairs = (q.pairs && typeof q.pairs === 'object' && !Array.isArray(q.pairs)
          ? q.pairs
          : {}) as Record<string, unknown>;
        const side = (v: unknown) =>
          (Array.isArray(v) ? v : []) as Array<Record<string, unknown>>;
        const mapping = (pairs.mapping && typeof pairs.mapping === 'object' && !Array.isArray(pairs.mapping)
          ? pairs.mapping
          : {}) as Record<string, string>;
        return {
          ...base,
          pairs: {
            left: side(pairs.left).map((s) => ({ id: String(s.id ?? ''), text: String(s.text ?? '') })),
            right: side(pairs.right).map((s) => ({ id: String(s.id ?? ''), text: String(s.text ?? '') })),
            mapping: Object.fromEntries(Object.entries(mapping).map(([k, v]) => [String(k), String(v)])),
          },
        };
      }
      if (q.type === 'BENAR_SALAH') {
        const statements = (Array.isArray(q.statements) ? q.statements : []) as Array<Record<string, unknown>>;
        return {
          ...base,
          statements: statements.map((s) => ({
            id: String(s.id ?? ''),
            text: String(s.text ?? ''),
            answer: Boolean(s.answer),
          })),
        };
      }
      return { ...base, acceptedAnswers: asStrArr(q.acceptedAnswers) };
    });

    const totalWeight = r2(links.reduce((sum, l) => sum + Number(l.question.weight || 0), 0));
    return {
      id: exam.id,
      title: exam.title,
      description: exam.description,
      mapel: exam.mapel,
      createdBy: exam.createdBy,
      totalWeight,
      sessions: exam._count.sessions,
      attempts: attempts.length,
      questions,
    };
  }

  async update(id: string, dto: ExamUpdateInput, actorId: string, actorRole: string) {
    const existing = await this.ownedWrite(id, actorId, actorRole);
    if (dto.mapelId) {
      const mapel = await this.prisma.mapel.findFirst({ where: { id: dto.mapelId, schoolId: existing.schoolId } });
      if (!mapel) throw new BadRequestException('Mapel tidak ditemukan di sekolah ini');
    }
    const exam = await this.prisma.exam.update({
      where: { id },
      data: {
        title: dto.title ?? undefined,
        description: dto.description !== undefined ? dto.description : undefined,
        mapelId: dto.mapelId ?? undefined,
      },
    });
    await this.audit.log({ actorId, action: 'EXAM_UPDATE', entity: 'Exam', entityId: id, schoolId: existing.schoolId, meta: { changes: dto } });
    return exam;
  }
  /**
   * Susun ulang soal ujian (ganti penuh sesuai urutan ID).
   * Soal harus milik guru yang sama (admin bebas).
   * Diblokir bila ada sesi AKTIF (mengubah konten saat berjalan merusak penilaian).
   */
  async setQuestions(id: string, dto: ExamQuestionsSetInput, actorId: string, actorRole: string) {
    const exam = await this.ownedWrite(id, actorId, actorRole);
    // Kunci susunan soal begitu ada sesi aktif ATAU ada peserta yang sudah
    // masuk (attempt apa pun) — jawaban merujuk soal yang lama; menukarnya
    // mid-flight merusak penilaian & buildState peserta.
    const [active, attemptsCount] = await Promise.all([
      this.prisma.examSession.count({ where: { examId: id, status: 'ACTIVE', ...tenantWhere() } }),
      this.prisma.attempt.count({ where: { session: { examId: id }, ...tenantWhere() } }),
    ]);
    if (active > 0) {
      throw new ConflictException('Ujian sedang berjalan di sesi aktif — susunan soal dikunci');
    }
    if (attemptsCount > 0) {
      throw new ConflictException('Soal sudah dikerjakan peserta — susunan soal dikunci');
    }
    const found = await this.prisma.question.findMany({
      where: { id: { in: dto.questionIds }, schoolId: exam.schoolId },
      select: { id: true, createdById: true, weight: true },
    });
    if (found.length !== dto.questionIds.length) {
      throw new BadRequestException('Sebagian soal tidak ditemukan');
    }
    if (actorRole !== 'ADMIN' && found.some((f) => f.createdById !== actorId)) {
      throw new BadRequestException('Hanya boleh memakai soal milik sendiri');
    }
    const weightById = new Map(found.map((f) => [f.id, f.weight]));
    await this.prisma.$transaction([
      this.prisma.examQuestion.deleteMany({ where: { examId: id } }),
      this.prisma.examQuestion.createMany({
        data: dto.questionIds.map((questionId, i) => ({ examId: id, questionId, order: i, schoolId: exam.schoolId })),
      }),
    ]);
    const totalWeight = dto.questionIds.reduce((s, qid) => s + (weightById.get(qid) ?? 0), 0);
    await this.audit.log({ actorId, action: 'EXAM_SET_QUESTIONS', entity: 'Exam', entityId: id, schoolId: exam.schoolId, meta: { count: dto.questionIds.length } });
    return { count: dto.questionIds.length, totalWeight };
  }

  /* --------------------------- enrol peserta -------------------------- */

  /** Peserta terdaftar ujian ini (untuk panel enrol). */
  async listEnrollments(examId: string, actorId: string, actorRole: string) {
    const exam = await this.examOrThrowManage(examId, actorId, actorRole);
    const rows = await this.prisma.examEnrollment.findMany({
      where: { examId, schoolId: exam.schoolId },
      include: {
        user: {
          select: { id: true, name: true, username: true, nisn: true, isActive: true, kelas: { select: { name: true } } },
        },
      },
      orderBy: { user: { name: 'asc' } },
    });
    return { data: rows.map((r) => r.user), total: rows.length };
  }

  /** Kandidat siswa aktif untuk dicari & di-enrol, dengan flag terdaftar. */
  async candidates(examId: string, q: ExamCandidatesQuery, actorId: string, actorRole: string) {
    const exam = await this.examOrThrowManage(examId, actorId, actorRole);
    // Kandidat = siswa aktif sekolah ini saja.
    const where: Prisma.UserWhereInput = { role: 'SISWA', isActive: true, schoolId: exam.schoolId };
    if (q.sessionId) {
      const sesi = await this.prisma.examSession.findFirst({ where: { id: q.sessionId, schoolId: exam.schoolId }, select: { kelasLinks: { select: { kelasId: true } } } });
      const kelasIds = (sesi?.kelasLinks ?? []).map((k) => k.kelasId);
      // Enrol dikonteks sesi: kandidat = siswa kelas peserta sesi.
      if (kelasIds.length === 0) return { data: [], totalEnrolled: 0 };
      where.kelasId = { in: kelasIds };
    } else if (q.kelasId) {
      where.kelasId = q.kelasId;
    }
    const search = q.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { nisn: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [enrolled, rows] = await Promise.all([
      this.prisma.examEnrollment.findMany({ where: { examId, schoolId: exam.schoolId }, select: { userId: true } }),
      this.prisma.user.findMany({
        where,
        select: { id: true, name: true, username: true, nisn: true, kelas: { select: { name: true } } },
        orderBy: { name: 'asc' },
        take: q.limit,
      }),
    ]);
    const enrolledSet = new Set(enrolled.map((e) => e.userId));
    return { data: rows.map((u) => ({ ...u, enrolled: enrolledSet.has(u.id) })), totalEnrolled: enrolledSet.size };
  }

  /** Ganti penuh set peserta (idempoten) — nilai kosong = kosongkan. */
  async setEnrollments(examId: string, dto: ExamEnrollInput, actorId: string, actorRole: string) {
    const exam = await this.examOrThrowManage(examId, actorId, actorRole);
    const unique = [...new Set(dto.userIds)];
    if (unique.length) {
      const valid = await this.prisma.user.count({ where: { id: { in: unique }, role: 'SISWA', isActive: true, schoolId: exam.schoolId } });
      if (valid !== unique.length) {
        throw new BadRequestException('Sebagian peserta bukan siswa aktif sekolah ini');
      }
    }
    await this.prisma.$transaction([
      this.prisma.examEnrollment.deleteMany({ where: { examId } }),
      this.prisma.examEnrollment.createMany({ data: unique.map((userId) => ({ examId, userId, schoolId: exam.schoolId })) }),
    ]);
    await this.audit.log({
      actorId,
      action: 'EXAM_ENROLL_SET',
      entity: 'Exam',
      entityId: examId,
      schoolId: exam.schoolId,
      meta: { count: unique.length },
    });
    return { total: unique.length };
  }

  async remove(id: string, actorId: string, actorRole: string) {
    const exam = await this.prisma.exam.findFirst({ where: { id, ...tenantWhere() }, include: { _count: { select: { sessions: true } } } });
    if (!exam || (actorRole !== "ADMIN" && exam.createdById !== actorId)) {
      throw new NotFoundException("Ujian tidak ditemukan");
    }
    if (exam._count.sessions > 0) {
      throw new ConflictException(`Ujian dipakai ${exam._count.sessions} sesi — tidak bisa dihapus`);
    }
    await this.prisma.exam.delete({ where: { id } });
    await this.audit.log({ actorId, action: 'EXAM_DELETE', entity: 'Exam', entityId: id, schoolId: exam.schoolId, meta: { title: exam.title } });
    return { ok: true };
  }
}
