import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AnswerReviewInput, ResultsPublishInput } from '@cbt/shared';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { tenantWhere } from '../common/tenant/tenant';

type QType = 'PG' | 'PG_KOMPLEKS' | 'MATCHING' | 'BENAR_SALAH' | 'ISIAN_SINGKAT';
type ScoringMode = 'ALL_OR_NOTHING' | 'PROPORSIONAL';

/** Soal yang cukup untuk dinilai (hanya kolom yang dipakai mesin penilaian). */
export interface GradableQuestion {
  id: string;
  type: QType;
  weight: number;
  scoringMode: ScoringMode;
  choices?: unknown;
  correctChoices?: unknown;
  pairs?: unknown;
  statements?: unknown;
  acceptedAnswers?: unknown;
}

export interface QuestionVerdict {
  /** true = benar penuh, false = salah, null = tidak ada jawaban yang bisa dinilai. */
  isCorrect: boolean | null;
  /** Rasio kebenaran 0..1 sebelum dikalikan bobot. */
  ratio: number;
  /** Skor otomatis = ratio × bobot. */
  score: number;
  /** Bobot soal (skor maksimum butir ini). */
  max: number;
  /** Butir yang perlu diputuskan guru (isian singkat tak cocok kunci). */
  needsReview: boolean;
  /** Jumlah item benar dari total item yang dinilai (PG kompleks/matching/benar-salah). */
  hits: number;
  total: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Normalisasi teks isian: trim, huruf kecil, spasi rapat. */
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Angka sederhana (mis. "0,5" atau "1500"); null bila bukan angka. */
function asNumber(s: string): number | null {
  const t = s.trim().replace(/\s+/g, '');
  if (!/^-?\d+([.,]\d+)?$/.test(t)) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Cocokkan isian singkat dengan daftar kunci (case-insensitive, tahan format angka). */
export function matchShortAnswer(payload: string, accepted: string[]): boolean {
  const given = norm(payload);
  for (const raw of accepted) {
    const key = norm(raw);
    if (key === given) return true;
    const a = asNumber(key);
    const b = asNumber(given);
    if (a !== null && b !== null && Math.abs(a - b) < 1e-9) return true;
  }
  return false;
}

const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const idArray = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map((x) => (x && typeof x === 'object' ? (x as { id?: unknown }).id : undefined)).filter((x): x is string => typeof x === 'string')
    : [];

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Apakah jawaban siswa kosong (tidak dikerjakan) untuk tipe tertentu. */
export function isBlank(q: GradableQuestion, payload: unknown): boolean {
  if (payload === null || payload === undefined) return true;
  switch (q.type) {
    case 'PG':
      return typeof payload !== 'string' || payload.trim() === '';
    case 'PG_KOMPLEKS':
      return strArray(payload).length === 0;
    case 'ISIAN_SINGKAT':
      return typeof payload !== 'string' || payload.trim() === '';
    case 'BENAR_SALAH':
    case 'MATCHING':
      return Object.keys(record(payload)).length === 0;
    default:
      return false;
  }
}

/**
 * Mesin penilaian satu butir (Fase 7).
 *
 * - PG: tepat satu kunci (all-or-nothing).
 * - PG_KOMPLEKS / MATCHING / BENAR_SALAH: ALL_OR_NOTHING (semua benar) atau
 *   PROPORSIONAL — rasio item benar; pilihan salah mengurangi (PG kompleks
 *   memakai hits − wrong agar menebak tidak Untung).
 * - ISIAN_SINGKAT: cocok kunci (multi-kunci, case-insensitive, angka) atau
 *   ditandai needsReview agar guru memutuskan manual.
 */
export function gradeQuestion(q: GradableQuestion, payload: unknown): QuestionVerdict {
  const max = Number(q.weight) || 0;
  const blank = isBlank(q, payload);
  const verdict = (ratio: number, hits: number, total: number, isCorrect: boolean | null, needsReview = false): QuestionVerdict => ({
    isCorrect,
    ratio,
    score: round2(ratio * max),
    max: round2(max),
    needsReview,
    hits,
    total,
  });

  switch (q.type) {
    case 'PG': {
      const key = strArray(q.correctChoices)[0];
      const ok = typeof payload === 'string' && key !== undefined && payload === key;
      return verdict(ok ? 1 : 0, ok ? 1 : 0, 1, blank ? null : ok);
    }

    case 'PG_KOMPLEKS': {
      const key = new Set(strArray(q.correctChoices));
      const selected = Array.from(new Set(strArray(payload)));
      const total = key.size;
      if (total === 0) return verdict(0, 0, 0, null);
      const hits = selected.filter((id) => key.has(id)).length;
      const wrong = selected.length - hits;
      const exact = hits === total && wrong === 0;
      const ratio =
        exact || q.scoringMode === 'ALL_OR_NOTHING' ? (exact ? 1 : 0) : Math.max(0, (hits - wrong) / total);
      return verdict(ratio, hits, total, blank ? null : exact);
    }

    case 'MATCHING': {
      const pairs = record(q.pairs);
      const left = idArray(pairs.left);
      const mapping = record(pairs.mapping);
      const answer = record(payload);
      const total = left.length;
      if (total === 0) return verdict(0, 0, 0, null);
      const hits = left.filter((id) => typeof answer[id] === 'string' && answer[id] === mapping[id]).length;
      const exact = hits === total;
      const ratio = exact || q.scoringMode === 'ALL_OR_NOTHING' ? (exact ? 1 : 0) : hits / total;
      return verdict(ratio, hits, total, blank ? null : exact);
    }

    case 'BENAR_SALAH': {
      const statements = Array.isArray(q.statements)
        ? (q.statements as Array<{ id?: unknown; answer?: unknown }>)
        : [];
      const answer = record(payload);
      const total = statements.length;
      if (total === 0) return verdict(0, 0, 0, null);
      const hits = statements.filter((s) => typeof s.id === 'string' && answer[s.id] === s.answer).length;
      const exact = hits === total;
      const ratio = exact || q.scoringMode === 'ALL_OR_NOTHING' ? (exact ? 1 : 0) : hits / total;
      return verdict(ratio, hits, total, blank ? null : exact);
    }

    case 'ISIAN_SINGKAT': {
      const accepted = strArray(q.acceptedAnswers);
      if (blank) return verdict(0, 0, accepted.length, null);
      const ok = matchShortAnswer(String(payload), accepted);
      // Tidak cocok kunci → putuskan guru (review manual isian singkat).
      return verdict(ok ? 1 : 0, ok ? 1 : 0, accepted.length, ok, !ok);
    }

    default:
      return verdict(0, 0, 0, null);
  }
}

/** Skor akhir butir: override guru menang atas skor otomatis. */
export function finalScore(answer: { score: number | null; reviewedScore: number | null }): number {
  const raw = answer.reviewedScore ?? answer.score ?? 0;
  return round2(raw);
}

/**
 * Benar/salah efektif satu butir: keputusan guru (reviewedScore) menang atas
 * hasil otomatis — dipakai analisis butir dan tampilan hasil.
 */
export function effectiveCorrect(v: QuestionVerdict | null, reviewedScore: number | null): boolean | null {
  if (reviewedScore !== null) return v !== null && v.max > 0 ? reviewedScore >= v.max : reviewedScore > 0;
  return v?.isCorrect ?? null;
}

/** Skor total satu attempt dari daftar skor butir. */
export function totalScore(scores: number[]): number {
  return round2(scores.reduce((a, b) => a + b, 0));
}

interface SessionForGrading {
  id: string;
  title: string | null;
  status: string;
  resultsPublished: boolean;
  examId: string;
  exam: { id: string; title: string; createdById: string; createdBy?: { role: string } | null; mapel?: { name: string; kkm: number } | null };
}

/**
 * Fase 7 — penilaian otomatis 5 tipe soal (bobot + all-or-nothing/proporsional),
 * review manual, publish hasil, dan analisis butir soal.
 */
@Injectable()
export class GradingService {
  private readonly logger = new Logger(GradingService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /* ----------------------------- otorisasi ---------------------------- */

  /** Sesi hanya boleh dikelola guru pemilik ujian atau admin. Proktor hanya boleh membaca. */
  private async sessionOrThrow(sessionId: string, actorId: string, role: string, opts?: { readOnly?: boolean }) {
    const s = await this.prisma.examSession.findFirst({
      where: { id: sessionId, ...tenantWhere() },
      include: { exam: { select: { id: true, title: true, createdById: true, createdBy: { select: { role: true } }, mapel: { select: { name: true, kkm: true } } } } },
    });
    if (!s) throw new NotFoundException('Sesi tidak ditemukan');
    if (role === 'ADMIN') return s as unknown as SessionForGrading;
    if (s.exam.createdById === actorId) return s as unknown as SessionForGrading;
    // Ujian buatan ADMIN dibagikan ke semua guru — guru boleh menilai sesinya.
    if (role === 'GURU' && s.exam.createdBy?.role === 'ADMIN') return s as unknown as SessionForGrading;
    // Nilai hanya untuk guru pemilik / ujian ADMIN + admin — proktor TIDAK boleh (keputusan 11 Nov 2026).
    throw new ForbiddenException('Anda bukan pemilik ujian/sesi ini');
  }

  /* ------------------------------ penilaian --------------------------- */

  /** Nilai ulang seluruh butir satu attempt; skor otomatis + total disimpan. */
  async gradeAttempt(attemptId: string) {
    const attempt = await this.prisma.attempt.findFirst({
      where: { id: attemptId, ...tenantWhere() },
      include: {
        answers: true,
        session: {
          include: { exam: { include: { questions: { include: { question: true } } } } },
        },
      },
    });
    if (!attempt) throw new NotFoundException('Attempt tidak ditemukan');

    const questions = attempt.session.exam.questions.map((row) => row.question as unknown as GradableQuestion);
    const byId = new Map(questions.map((q) => [q.id, q]));
    const maxScore = round2(questions.reduce((sum, q) => sum + (Number(q.weight) || 0), 0));

    let pendingReview = 0;
    const scores: number[] = [];
    for (const a of attempt.answers) {
      const q = byId.get(a.questionId);
      if (!q) continue;
      const v = gradeQuestion(q, a.payload);
      const reviewed = a.reviewedScore !== null;
      if (v.needsReview && !reviewed) pendingReview += 1;
      scores.push(finalScore({ score: v.score, reviewedScore: a.reviewedScore }));
      // Skor otomatis selalu disegarkan; tapi butir yang sudah diputuskan guru
      // tidak boleh ditimpa balik oleh hasil otomatis.
      if (a.score !== v.score || (!reviewed && a.isCorrect !== v.isCorrect)) {
        await this.prisma.attemptAnswer.update({
          where: { id: a.id },
          data: { score: v.score, ...(reviewed ? {} : { isCorrect: v.isCorrect }) },
        });
      }
    }

    const score = totalScore(scores);
    await this.prisma.attempt.update({ where: { id: attemptId }, data: { score } });
    return {
      attemptId,
      score,
      maxScore,
      answered: attempt.answers.length,
      questionCount: questions.length,
      pendingReview,
    };
  }

  /** Nilai ulang semua attempt yang sudah selesai di satu sesi (attempt aktif dilewati). */
  async gradeSession(sessionId: string) {
    // Attempt yang waktunya habis tapi belum tersentuh → tandai EXPIRED dulu.
    const now = new Date();
    await this.prisma.attempt.updateMany({
      where: { sessionId, status: 'IN_PROGRESS', expiresAt: { lte: now }, ...tenantWhere() },
      data: { status: 'EXPIRED', submittedAt: now },
    });
    const attempts = await this.prisma.attempt.findMany({
      where: { sessionId, status: { not: 'IN_PROGRESS' }, ...tenantWhere() },
      select: { id: true },
    });
    let graded = 0;
    let pendingReview = 0;
    for (const a of attempts) {
      const res = await this.gradeAttempt(a.id);
      graded += 1;
      pendingReview += res.pendingReview;
    }
    return { sessionId, graded, skipped: 0, pendingReview };
  }

  /** Nilai ulang satu sesi dengan cek kepemilikan (dipakai endpoint guru). */
  async gradeSessionFor(sessionId: string, actorId: string, role: string) {
    await this.sessionOrThrow(sessionId, actorId, role);
    return this.gradeSession(sessionId);
  }

  /* --------------------------- review manual -------------------------- */

  /** Butir isian singkat yang tidak cocok kunci mana pun dan belum diputuskan guru. */
  private pendingReviewFilter() {
    return (a: { payload: unknown; reviewedScore: number | null; isCorrect: boolean | null; question: { type: string; acceptedAnswers: unknown } }) =>
      a.reviewedScore === null &&
      a.question.type === 'ISIAN_SINGKAT' &&
      !isBlank(a.question as unknown as GradableQuestion, a.payload) &&
      a.isCorrect !== true;
  }

  /** Hanya attempt yang sudah selesai — jawaban peserta yang masih mengerjakan belum final. */
  private async pendingRows(sessionId: string) {
    const answers = await this.prisma.attemptAnswer.findMany({
      where: { attempt: { sessionId, status: { not: 'IN_PROGRESS' } }, question: { type: 'ISIAN_SINGKAT' }, ...tenantWhere() },
      include: {
        question: { select: { id: true, type: true, content: true, weight: true, acceptedAnswers: true } },
        attempt: {
          select: {
            id: true,
            status: true,
            score: true,
            user: { select: { id: true, name: true, username: true, nisn: true, kelas: { select: { name: true } } } },
          },
        },
      },
      orderBy: [{ attemptId: 'asc' }],
    });
    return answers.filter(this.pendingReviewFilter());
  }

  /** Jumlah butir isian singkat menunggu review — gerbang ekspor nilai (guru harus menilai dulu). */
  async countPendingReview(sessionId: string): Promise<number> {
    return (await this.pendingRows(sessionId)).length;
  }

  async reviews(sessionId: string, actorId: string, role: string) {
    await this.sessionOrThrow(sessionId, actorId, role, { readOnly: true });
    const rows = await this.pendingRows(sessionId);
    return {
      data: rows.map((a) => ({
        attemptId: a.attemptId,
        questionId: a.questionId,
        /** Jawaban apa adanya dari siswa (perlu dibaca guru). */
        answer: typeof a.payload === 'string' ? a.payload : String(a.payload ?? ''),
        maxScore: round2(Number(a.question.weight) || 0),
        question: { id: a.question.id, content: a.question.content },
        acceptedAnswers: strArray(a.question.acceptedAnswers),
        user: a.attempt.user,
      })),
      total: rows.length,
    };
  }

  /** Putuskan skor manual satu butir (isian singkat); skor total attempt dihitung ulang. */
  async review(attemptId: string, dto: AnswerReviewInput, actorId: string, role: string) {
    const attempt = await this.prisma.attempt.findFirst({
      where: { id: attemptId, ...tenantWhere() },
      include: {
        session: { include: { exam: { select: { id: true, title: true, createdById: true, createdBy: { select: { role: true } } } } } },
      },
    });
    if (!attempt) throw new NotFoundException('Attempt tidak ditemukan');
    if (role !== 'ADMIN' && attempt.session.exam.createdById !== actorId) {
      if (!(role === 'GURU' && attempt.session.exam.createdBy?.role === 'ADMIN')) {
        throw new ForbiddenException('Anda bukan pemilik ujian/sesi ini');
      }
    }
    if (attempt.status === 'IN_PROGRESS') {
      throw new ConflictException('Peserta masih mengerjakan — review setelah ujian selesai');
    }
    const answer = await this.prisma.attemptAnswer.findUnique({
      where: { attemptId_questionId: { attemptId, questionId: dto.questionId } },
      include: { question: { select: { id: true, weight: true, type: true } } },
    });
    if (!answer) throw new NotFoundException('Jawaban tidak ditemukan');
    // Review manual hanya untuk isian singkat — butir lain dinilai otomatis
    // dan diputuskan lewat alurnya sendiri (bukan lewat override skor).
    if (answer.question.type !== 'ISIAN_SINGKAT') {
      throw new BadRequestException('Review manual hanya berlaku untuk soal isian singkat');
    }
    const maxScore = round2(Number(answer.question.weight) || 0);
    if (dto.score > maxScore) {
      throw new BadRequestException(`Skor maksimal butir ini ${maxScore} (bobot soal)`);
    }
    await this.prisma.attemptAnswer.update({
      where: { id: answer.id },
      data: {
        reviewedScore: round2(dto.score),
        reviewedById: actorId,
        reviewNote: dto.note ?? null,
        isCorrect: dto.score >= maxScore ? true : dto.score <= 0 ? false : answer.isCorrect,
      },
    });
    const regraded = await this.gradeAttempt(attemptId);
    await this.audit.log({
      actorId,
      action: 'ANSWER_REVIEW',
      entity: 'AttemptAnswer',
      entityId: answer.id,
      schoolId: attempt.schoolId,
      meta: { attemptId, questionId: dto.questionId, score: round2(dto.score), maxScore, note: dto.note ?? null },
    });
    return { ok: true as const, ...regraded, questionId: dto.questionId };
  }

  /* ----------------------------- publish ------------------------------ */

  /** Terbitkan hasil ke siswa (semua peserta selesai + review tuntas) atau tarik kembali. */
  async publish(sessionId: string, dto: ResultsPublishInput, actorId: string, role: string) {
    // Tegaskan kepemilikan/akses — hasil publish tidak untuk guru/proktor lain.
    await this.sessionOrThrow(sessionId, actorId, role);
    if (dto.published) {
      // Kedaluwarsakan dulu attempt yang waktunya habis (gradeSession
      // menandai EXPIRED) SEBELUM menghitung yang masih berjalan — kalau
      // tidak, publish hampir selalu gagal palsu dan operator dipaksa
      // force-submit satu per satu padahal waktu sudah habis.
      const graded = await this.gradeSession(sessionId);
      const running = await this.prisma.attempt.count({ where: { sessionId, status: 'IN_PROGRESS' } });
      if (running > 0) {
        throw new ConflictException(
          `Masih ada ${running} peserta yang belum menyelesaikan ujian — tunggu atau kumpulkan paksa dulu`,
        );
      }
      const pending = graded.pendingReview;
      if (pending > 0) {
        throw new ConflictException(
          `Masih ada ${pending} jawaban isian singkat yang perlu direview manual — selesaikan dulu sebelum publish`,
        );
      }
    }
    const updated = await this.prisma.examSession.update({
      where: { id: sessionId },
      data: { resultsPublished: dto.published },
    });
    await this.audit.log({
      actorId,
      action: dto.published ? 'RESULTS_PUBLISH' : 'RESULTS_UNPUBLISH',
      entity: 'ExamSession',
      entityId: sessionId,
    });
    this.logger.log(`Sesi ${sessionId}: hasil ${dto.published ? 'diterbitkan' : 'ditarik'} oleh ${actorId}`);
    return { ok: true as const, sessionId, resultsPublished: updated.resultsPublished };
  }

  /* ------------------------------ laporan ----------------------------- */

  /** Ringkasan penilaian satu sesi: statistik skor + progres + review tertunda. */
  async summary(sessionId: string, actorId: string, role: string) {
    const s = await this.sessionOrThrow(sessionId, actorId, role, { readOnly: true });
    const [questions, attempts, pending] = await Promise.all([
      this.prisma.examQuestion.findMany({
        where: { examId: s.examId },
        include: { question: { select: { id: true, weight: true, type: true, scoringMode: true } } },
        orderBy: { order: 'asc' },
      }),
      this.prisma.attempt.findMany({
        where: { sessionId },
        include: { user: { select: { id: true, name: true, username: true, nisn: true, kelas: { select: { name: true } } } } },
        orderBy: { startedAt: 'asc' },
      }),
      this.pendingRows(sessionId),
    ]);

    const maxScore = round2(questions.reduce((sum, q) => sum + (Number(q.question.weight) || 0), 0));
    const kkm = s.exam.mapel?.kkm ?? 75;
    const finished = attempts.filter((a) => a.status !== 'IN_PROGRESS');
    const scored = finished.filter((a) => a.score !== null).map((a) => a.score as number).sort((x, y) => x - y);
    // Ketuntasan dihitung terhadap KKM mapel (diatur guru mata pelajaran), skala persen.
    const pctOf = (v: number) => (maxScore > 0 ? (v / maxScore) * 100 : 0);
    const passCount = finished.filter((a) => a.score !== null && pctOf(a.score) >= kkm).length;
    const avg = scored.length ? round2(scored.reduce((x, y) => x + y, 0) / scored.length) : 0;
    const pct = (v: number) => (maxScore > 0 ? round2((v / maxScore) * 100) : 0);

    // Sebaran nilai dalam 5 pita (0–20, 21–40, … 81–100 persen).
    const buckets = [0, 0, 0, 0, 0];
    for (const v of scored) {
      const p = pct(v);
      buckets[Math.min(4, Math.floor(p / 20))] += 1;
    }

    return {
      sessionId,
      session: {
        id: s.id,
        title: s.title ?? s.exam.title,
        examId: s.exam.id,
        examTitle: s.exam.title,
        mapel: s.exam.mapel?.name ?? null,
        status: s.status,
        resultsPublished: s.resultsPublished,
      },
      kkm,
      questionCount: questions.length,
      maxScore,
      totalWeight: maxScore,
      summary: {
        total: attempts.length,
        inProgress: attempts.length - finished.length,
        finished: finished.length,
        graded: finished.filter((a) => a.score !== null).length,
        pendingReview: pending.length,
        passCount,
        failCount: Math.max(0, finished.filter((a) => a.score !== null).length - passCount),
        avgScore: avg,
        avgPercent: pct(avg),
        maxScore: scored.length ? scored[scored.length - 1] : 0,
        minScore: scored.length ? scored[0] : 0,
        highest: scored.length ? pct(scored[scored.length - 1]) : 0,
        lowest: scored.length ? pct(scored[0]) : 0,
        distribution: buckets.map((count, i) => ({
          label: i === 4 ? '81–100' : `${i * 20 + (i === 0 ? 0 : 1)}–${(i + 1) * 20}`,
          min: i * 20,
          max: (i + 1) * 20,
          count,
        })),
      },
    };
  }

  /** Hasil per peserta beserta rincian skor tiap butir. */
  async results(sessionId: string, actorId: string, role: string) {
    const s = await this.sessionOrThrow(sessionId, actorId, role, { readOnly: true });
    const [questions, attempts] = await Promise.all([
      // Seluruh kolom soal wajib ikut: mesin penilaian menilai ulang tiap butir
      // (kunci ada di choices/pairs/statements/acceptedAnswers).
      this.prisma.examQuestion.findMany({
        where: { examId: s.examId },
        include: { question: true },
        orderBy: { order: 'asc' },
      }),
      this.prisma.attempt.findMany({
        where: { sessionId },
        include: {
          user: { select: { id: true, name: true, username: true, nisn: true, kelas: { select: { name: true } } } },
          answers: true,
        },
        orderBy: { startedAt: 'asc' },
      }),
    ]);
    const maxScore = round2(questions.reduce((sum, q) => sum + (Number(q.question.weight) || 0), 0));
    const data = attempts.map((a) => {
      const byQ = new Map(a.answers.map((x) => [x.questionId, x]));
      const items = questions.map((link) => {
        const ans = byQ.get(link.question.id);
        const verdict = ans ? gradeQuestion(link.question as unknown as GradableQuestion, ans.payload) : null;
        return {
          questionId: link.question.id,
          type: link.question.type,
          weight: round2(Number(link.question.weight) || 0),
          score: ans ? finalScore(ans) : 0,
          autoScore: ans?.score ?? 0,
          reviewedScore: ans?.reviewedScore ?? null,
          isCorrect: effectiveCorrect(verdict, ans?.reviewedScore ?? null),
          needsReview: Boolean(
            verdict?.needsReview && ans?.reviewedScore === null && a.status !== 'IN_PROGRESS',
          ),
        };
      });
      return {
        attemptId: a.id,
        user: a.user,
        status: a.status,
        startedAt: a.startedAt,
        submittedAt: a.submittedAt,
        violationCount: a.violationCount,
        score: finalScore({ score: a.score, reviewedScore: null }),
        maxScore,
        percent: maxScore > 0 ? round2(((a.score ?? 0) / maxScore) * 100) : 0,
        pendingReview: items.filter((i) => i.needsReview).length,
        items,
      };
    });
    const kkm = s.exam.mapel?.kkm ?? 75;
    return { sessionId, maxScore, questionCount: questions.length, kkm, data };
  }

  /** Analisis butir soal: tingkat kesulitan, daya pembeda, sebaran pengecoh. */
  async itemAnalysis(sessionId: string, actorId: string, role: string) {
    const s = await this.sessionOrThrow(sessionId, actorId, role, { readOnly: true });
    const [links, attempts] = await Promise.all([
      this.prisma.examQuestion.findMany({
        where: { examId: s.examId },
        include: { question: true },
        orderBy: { order: 'asc' },
      }),
      this.prisma.attempt.findMany({
        where: { sessionId, status: { not: 'IN_PROGRESS' } },
        include: { answers: true },
      }),
    ]);

    const maxScore = round2(links.reduce((sum, l) => sum + (Number(l.question.weight) || 0), 0));
    // Peringkat peserta untuk daya pembeda (kelompok atas/bawah 27%).
    const ranked = attempts
      .map((a) => ({ id: a.id, score: a.score ?? 0, answers: new Map(a.answers.map((x) => [x.questionId, x])) }))
      .sort((x, y) => y.score - x.score);
    const groupSize = Math.max(1, Math.round(ranked.length * 0.27));
    const upper = ranked.length >= 4 ? ranked.slice(0, groupSize) : [];
    const lower = ranked.length >= 4 ? ranked.slice(-groupSize) : [];

    const data = links.map((link, i) => {
      const q = link.question as unknown as GradableQuestion & { content: string };
      const weight = round2(Number(q.weight) || 0);
      let answered = 0;
      let attempted = 0;
      let blank = 0;
      let hits = 0;
      let earned = 0;
      const distractor = new Map<string, number>();
      for (const id of strArray(q.correctChoices)) distractor.set(id, 0);

      for (const a of attempts) {
        const ans = a.answers.find((x) => x.questionId === q.id);
        if (ans) answered += 1;
        if (!ans || isBlank(q, ans.payload)) {
          blank += 1;
          continue;
        }
        attempted += 1;
        const v = gradeQuestion(q, ans.payload);
        // Butir yang sudah diputuskan guru dihitung sesuai keputusan itu.
        if (effectiveCorrect(v, ans.reviewedScore) === true) hits += 1;
        earned += ans.reviewedScore ?? v.score;
        if (q.type === 'PG') {
          const picked = typeof ans.payload === 'string' ? ans.payload : '(kosong)';
          distractor.set(picked, (distractor.get(picked) ?? 0) + 1);
        } else if (q.type === 'PG_KOMPLEKS') {
          for (const id of strArray(ans.payload)) distractor.set(id, (distractor.get(id) ?? 0) + 1);
        }
      }

      // Tingkat kesulitan dihitung dari peserta yang benar-benar menjawab.
      const p = attempted > 0 ? hits / attempted : 0;
      const correctIn = (group: typeof ranked) =>
        group.reduce((sum, a) => {
          const ans = a.answers.get(q.id);
          if (!ans) return sum;
          const v = gradeQuestion(q, ans.payload);
          return sum + (effectiveCorrect(v, ans.reviewedScore) === true ? 1 : 0);
        }, 0);
      const discrimination =
        upper.length && lower.length
          ? round2((correctIn(upper) - correctIn(lower)) / upper.length)
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

      const choices = q.type === 'PG' || q.type === 'PG_KOMPLEKS'
        ? (Array.isArray(q.choices) ? (q.choices as Array<{ id?: unknown; label?: unknown }>) : []).map((c) => ({
            id: String(c.id ?? ''),
            label: String(c.label ?? ''),
            isKey: strArray(q.correctChoices).includes(String(c.id ?? '')),
            picked: distractor.get(String(c.id ?? '')) ?? 0,
          }))
        : [];

      return {
        order: i + 1,
        questionId: q.id,
        type: q.type,
        content: q.content,
        scoringMode: q.scoringMode,
        weight,
        answered,
        blank,
        correct: hits,
        /** Tingkat kesulitan (0..1): makin tinggi makin mudah. */
        difficulty: round2(p),
        difficultyLabel: level,
        /** Daya pembeda (D): ≥0,4 baik; <0,2 perlu diperbaiki. */
        discrimination,
        discriminationLabel,
        avgScore: attempted > 0 ? round2(earned / attempted) : 0,
        avgPercent: weight > 0 && attempted > 0 ? round2((earned / attempted / weight) * 100) : 0,
        choices,
      };
    });

    return { sessionId, examId: s.examId, maxScore, attempts: attempts.length, groupSize, data };
  }

}
