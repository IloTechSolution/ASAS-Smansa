import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Question } from '@prisma/client';
import { AttemptIntegrityInput, AttemptStartInput, AttemptSubmitInput, AttemptUnlockInput } from '@cbt/shared';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { tenantWhere } from '../common/tenant/tenant';
import { GradingService } from '../grading/grading.service';
import { MonitoringGateway } from '../monitoring/monitoring.gateway';
import { TokenService } from '../token/token.service';
import { SebProof, parseSebKeys, verifySebRequest } from './seb';
import { SessionQuestionCache } from './session-question-cache';

/** Kunci HASH Redis tempat autosave jawaban disimpan (keputusan Fase 0/Fase 5). */
const answerHash = (attemptId: string) => `attempt:${attemptId}:answer`;

/** Autosave membutuhkan daftar soal untuk validasi; susun soal dikunci saat attempt ada. */
const QUESTION_CACHE_TTL_MS = 10 * 60 * 1000;
const QUESTION_CACHE_MAX_SESSIONS = 128;

/** PRNG deterministik dari string (agar urutan acak tetap saat resume/refresh). */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Sesi ujian siswa: gate token, timer server-side, autosave, integritas. */
@Injectable()
export class AttemptsService {
  private readonly logger = new Logger(AttemptsService.name);
  private readonly questionCache = new SessionQuestionCache<Question>(
    QUESTION_CACHE_TTL_MS,
    QUESTION_CACHE_MAX_SESSIONS,
  );

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TokenService) private readonly token: TokenService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MonitoringGateway) private readonly gateway: MonitoringGateway,
    @Inject(GradingService) private readonly grading: GradingService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  /* ----------------------------- helpers ----------------------------- */

  /**
   * Sesi wajib SEB hanya boleh diakses bila header request-hash SEB cocok
   * dengan Browser Exam Key milik server. Laporan `dto.seb` dari klien tidak
   * pernah dipercaya untuk gate ini.
   */
  private assertSeb(required: boolean, proof?: SebProof) {
    if (!required) return;
    const keys = parseSebKeys(this.config.get<string>('SEB_BROWSER_EXAM_KEY'));
    if (keys.length === 0) {
      throw new ServiceUnavailableException(
        'Verifikasi Safe Exam Browser belum dikonfigurasi di server — hubungi administrator',
      );
    }
    if (!verifySebRequest(proof, keys)) {
      throw new BadRequestException(
        'Verifikasi Safe Exam Browser gagal — buka ujian melalui SEB dengan konfigurasi yang benar',
      );
    }
  }

  private isSebVerified(proof?: SebProof) {
    return verifySebRequest(proof, parseSebKeys(this.config.get<string>('SEB_BROWSER_EXAM_KEY')));
  }

  private async loadSession(sessionId: string) {
    const s = await this.prisma.examSession.findFirst({
      where: { id: sessionId, ...tenantWhere() },
      include: {
        exam: {
          select: {
            id: true,
            title: true,
            mapel: { select: { id: true, name: true } },
            questions: {
              orderBy: { order: 'asc' },
              include: { question: true },
            },
          },
        },
        kelasLinks: { select: { kelasId: true } },
      },
    });
    if (!s) throw new NotFoundException('Sesi tidak ditemukan');
    return s;
  }

  /**
   * Daftar soal sesi untuk validasi autosave. Tanpa cache, setiap saveAnswer
   * memuat ulang seluruh soal dari DB (≈27–80 kali/detik pada 400 siswa).
   */
  private questionsForSession(sessionId: string) {
    return this.questionCache.get(sessionId, async () => {
      const session = await this.loadSession(sessionId);
      return new Map(session.exam.questions.map((row) => [row.question.id, row.question] as const));
    });
  }

  /** Nilai tanpa menggagalkan alur — kegagalan dicatat, bisa dinilai ulang saat publish. */
  private async gradeQuietly(attemptId: string) {
    try {
      await this.grading.gradeAttempt(attemptId);
    } catch (e) {
      this.logger.warn(`Penilaian attempt ${attemptId} gagal: ${(e as Error).message} — akan dinilai ulang saat publish`);
    }
  }

  /** Tandai EXPIRED otomatis bila waktu habis; kembalikan attempt terbaru. */
  private async syncExpiry(attempt: { id: string; status: string; expiresAt: Date; submittedAt: Date | null; score?: number | null; violationCount?: number }) {
    if (attempt.status === 'IN_PROGRESS' && attempt.expiresAt.getTime() <= Date.now()) {
      // updateMany + guard status: request bersamaan (poll & autosave) tidak
      // bisa saling menimpa status attempt yang sudah SUBMITTED/FORCE_SUBMITTED.
      const res = await this.prisma.attempt.updateMany({
        where: { id: attempt.id, status: 'IN_PROGRESS' },
        data: { status: 'EXPIRED', submittedAt: attempt.expiresAt },
      });
      if (res.count === 1) {
        // Waktu habis = ujian selesai → nilailah sekarang (Fase 7).
        await this.gradeQuietly(attempt.id);
        return { ...attempt, status: 'EXPIRED', submittedAt: attempt.expiresAt };
      }
      // Kalah balapan — status final sudah ditulis request lain; baca ulang.
      const fresh = await this.prisma.attempt.findUnique({ where: { id: attempt.id } });
      return fresh ?? attempt;
    }
    // Sembuh sendiri: attempt selesai tapi belum bernilai (penilaian sempat gagal) → nilai ulang.
    if (attempt.status !== 'IN_PROGRESS' && attempt.score === null) {
      await this.gradeQuietly(attempt.id);
    }
    return attempt as { id: string; status: string; expiresAt: Date; submittedAt: Date | null; score?: number | null; violationCount?: number };
  }

  private toJson(payload: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (payload === null || payload === undefined) return Prisma.JsonNull;
    return payload as Prisma.InputJsonValue;
  }

  /* ------------------------------ akses ------------------------------ */

  private async studentOrThrow(studentId: string) {
    const u = await this.prisma.user.findFirst({
      where: { id: studentId, ...tenantWhere() },
      select: { id: true, role: true, kelasId: true, isActive: true, schoolId: true },
    });
    if (!u || !u.isActive) throw new ForbiddenException('Akun tidak aktif');
    if (u.role !== 'SISWA') throw new ForbiddenException('Hanya siswa yang bisa mengerjakan ujian');
    return u;
  }

  private async ownedAttempt(studentId: string, attemptId: string) {
    const a = await this.prisma.attempt.findFirst({
      where: { id: attemptId, ...tenantWhere() },
      include: { session: { select: { requireSeb: true, schoolId: true } } },
    });
    if (!a || a.userId !== studentId) throw new NotFoundException('Attempt tidak ditemukan');
    return a;
  }

  /** Attempt terkunci (batas pelanggaran) — tolak semua mutasi sampai dibuka. */
  private assertNotLocked(attempt: { lockedAt: Date | null }) {
    if (attempt.lockedAt) {
      throw new HttpException(
        { message: 'Ujian terkunci — minta token kepada proktor untuk membuka kembali', code: 'ATTEMPT_LOCKED' },
        423,
      );
    }
  }

  private assertInKelas(session: { kelasLinks: { kelasId: string }[] }, kelasId: string | null) {
    if (!kelasId || !session.kelasLinks.some((k) => k.kelasId === kelasId)) {
      throw new ForbiddenException('Anda tidak terdaftar sebagai peserta sesi ini');
    }
  }

  /**
   * Gerbang enrol ujian: bila ujian punya enrol eksplisit, siswa harus
   * terdaftar; bila kosong, semua kelas peserta sesi boleh (mode lama).
   * Mengembalikan id enrollment bila ada (dipakai pemanggil yang butuh).
   */
  private async assertEnrolled(examId: string, studentId: string) {
    const count = await this.prisma.examEnrollment.count({ where: { examId } });
    if (count === 0) return;
    const mine = await this.prisma.examEnrollment.findUnique({
      where: { examId_userId: { examId, userId: studentId } },
      select: { userId: true },
    });
    if (!mine) {
      throw new ForbiddenException('Anda tidak terdaftar pada ujian ini — hubungi guru/proktor');
    }
  }

  /* ---------------------------- daftar sesi -------------------------- */

  /** Daftar sesi untuk siswa: sesi kelasnya + ringkasan attempt miliknya. */
  async available(studentId: string) {
    const student = await this.studentOrThrow(studentId);
    if (!student.kelasId) return { data: [] };
    const sessions = await this.prisma.examSession.findMany({
      where: {
        ...tenantWhere(),
        OR: [
          { visibleToSiswa: true, kelasLinks: { some: { kelasId: student.kelasId } } },
          // Hasil yang sudah terbit tetap tampil bagi siswa yang mengerjakan
          // (nilai tidak pernah dikirim; hanya menampilkan "Sudah dikerjakan").
          { resultsPublished: true, attempts: { some: { userId: studentId } } },
        ],
      },
      include: {
        exam: { select: { id: true, title: true, mapel: { select: { name: true } } } },
      },
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
    });
    // Ujian dengan enrol eksplisit hanya tampil untuk siswa yang terdaftar.
    const examIds = [...new Set(sessions.map((s) => s.exam.id))];
    const enrolledRows = examIds.length
      ? await this.prisma.examEnrollment.findMany({ where: { examId: { in: examIds }, userId: studentId, ...tenantWhere() }, select: { examId: true } })
      : [];
    const enrolledExamIds = new Set(enrolledRows.map((r) => r.examId));
    const enrollmentCounts = examIds.length
      ? await this.prisma.examEnrollment.groupBy({ by: ['examId'], where: { examId: { in: examIds }, ...tenantWhere() }, _count: { userId: true } })
      : [];
    const countByExam = new Map(enrollmentCounts.map((r) => [r.examId, r._count.userId]));
    const attempts = await this.prisma.attempt.findMany({
      where: { userId: studentId, sessionId: { in: sessions.map((s) => s.id) }, ...tenantWhere() },
    });
    const bySession = new Map(attempts.map((a) => [a.sessionId, a]));
    const visibleSessions = sessions.filter(
      (s) => (countByExam.get(s.exam.id) ?? 0) === 0 || enrolledExamIds.has(s.exam.id) || bySession.has(s.id),
    );
    const now = Date.now();
    return {
      data: visibleSessions.map((s) => {
        const a = bySession.get(s.id);
        const expired = s.endsAt ? s.endsAt.getTime() <= now : false;
        return {
          id: s.id,
          title: s.title ?? s.exam.title,
          exam: s.exam,
          status: s.status,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          durationMin: s.durationMin,
          requireSeb: s.requireSeb,
          expired,
          resultsPublished: s.resultsPublished,
          attempt: a
            ? {
                id: a.id,
                status: a.status,
                submittedAt: a.submittedAt,
                // Nilai TIDAK PERNAH dikirim ke siswa (keputusan sekolah, 11 Nov 2026) — guru membagikan lewat ekspor Excel.
                score: null,
                expiresAt: a.expiresAt,
                lockedAt: a.lockedAt ?? null,
                isActive: a.status === 'IN_PROGRESS' && a.expiresAt.getTime() > now,
              }
            : null,
        };
      }),
    };
  }

  /* ------------------------------- start ----------------------------- */

  async start(
    studentId: string,
    dto: AttemptStartInput,
    ip?: string,
    userAgent?: string | null,
    sebProof?: SebProof,
  ) {
    const student = await this.studentOrThrow(studentId);
    const session = await this.loadSession(dto.sessionId);
    this.assertInKelas(session, student.kelasId);
    await this.assertEnrolled(session.examId ?? session.exam.id, studentId);

    if (!session.visibleToSiswa) {
      throw new ConflictException('Sesi belum ditampilkan ke siswa — minta proktor menampilkan ujian ini dulu');
    }
    if (session.status === 'CLOSED') {
      throw new ConflictException('Sesi sudah ditutup');
    }
    const now = Date.now();
    if (session.startsAt && session.startsAt.getTime() > now) {
      throw new ConflictException('Sesi belum dimulai — tunggu jadwal mulai yang ditentukan proktor');
    }
    if (session.endsAt && session.endsAt.getTime() <= now) {
      throw new ConflictException('Waktu ujian telah berakhir');
    }
    this.assertSeb(session.requireSeb, sebProof);
    const sebVerified = this.isSebVerified(sebProof);
    const tokenOk = await this.token.checkStartGate(session, dto.token, studentId);
    if (!tokenOk) {
      throw new BadRequestException('Token salah atau kedaluwarsa — minta token terbaru ke proktor');
    }

    const existing = await this.prisma.attempt.findUnique({
      where: { sessionId_userId: { sessionId: session.id, userId: studentId } },
    }); // unik (sessionId,userId) — sesi sudah ter-scope
    if (existing) {
      if (sebVerified && !existing.sebVerified) {
        await this.prisma.attempt.update({ where: { id: existing.id }, data: { sebVerified: true } });
      }
      const synced = await this.syncExpiry(existing);
      if (synced.status !== 'IN_PROGRESS') {
        throw new ConflictException('Anda sudah menyelesaikan ujian ini');
      }
      return this.buildState(synced.id);
    }

    const durationMs = session.durationMin * 60_000;
    const hardEnd = session.endsAt ? session.endsAt.getTime() : Number.POSITIVE_INFINITY;
    const expiresAt = new Date(Math.min(now + durationMs, hardEnd));
    let attempt;
    try {
      attempt = await this.prisma.attempt.create({
        data: {
          sessionId: session.id,
          userId: studentId,
          expiresAt,
          status: 'IN_PROGRESS',
          ip: ip ?? null,
          userAgent: userAgent ?? null,
          sebVerified,
          startedAt: new Date(),
          schoolId: session.schoolId,
        },
      });
    } catch (e) {
      // Dua request start bersamaan (double-click/retry) — unique
      // (sessionId,userId) menangkap salah satunya. Kembalikan attempt yang
      // sudah dibuat, bukan 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const raced = await this.prisma.attempt.findUnique({
          where: { sessionId_userId: { sessionId: session.id, userId: studentId } },
        });
        if (!raced) throw e;
        const synced = await this.syncExpiry(raced);
        if (synced.status !== 'IN_PROGRESS') {
          throw new ConflictException('Anda sudah menyelesaikan ujian ini');
        }
        return this.buildState(synced.id);
      }
      throw e;
    }
    await this.audit.log({
      actorId: studentId,
      action: 'ATTEMPT_START',
      entity: 'Attempt',
      entityId: attempt.id,
      schoolId: session.schoolId,
      meta: { sessionId: session.id },
    });
    this.gateway.notifyActivity(session.id, attempt.id, 'start');
    return this.buildState(attempt.id);
  }

  /* ------------------------------- state ----------------------------- */

  async state(studentId: string, attemptId: string, sebProof?: SebProof) {
    const a = await this.ownedAttempt(studentId, attemptId);
    this.assertSeb(a.session.requireSeb, sebProof);
    // Samakan dengan start/saveAnswer/submit: attempt kedaluwarsa harus
    // dinilai + tampil EXPIRED juga saat klien hanya polling state.
    await this.syncExpiry(a);
    return this.buildState(attemptId);
  }

  private sanitizeQuestion(
    row: { order: number; question: Record<string, unknown> },
    shuffleQuestions: boolean,
    shuffleOptions: boolean,
    attemptId: string,
  ) {
    const q = row.question as {
      id: string;
      type: string;
      content: string;
      imageUrl: string | null;
      weight: number;
      scoringMode: string;
      choices: unknown;
      pairs: unknown;
      statements: unknown;
    };
    const base = {
      id: q.id,
      type: q.type,
      content: q.content,
      imageUrl: q.imageUrl,
      weight: q.weight,
      scoringMode: q.scoringMode,
    };
    const optRand = () => makeRng(hashSeed(`${attemptId}:${q.id}`));
    if (q.type === 'PG' || q.type === 'PG_KOMPLEKS') {
      const choices = (Array.isArray(q.choices) ? q.choices : []) as Array<Record<string, unknown>>;
      return { ...base, choices: shuffleOptions ? shuffle(choices, optRand()) : choices };
    }
    if (q.type === 'MATCHING') {
      const pairs = (q.pairs ?? { left: [], right: [] }) as { left: unknown[]; right: unknown[] };
      return {
        ...base,
        pairs: {
          left: Array.isArray(pairs.left) ? pairs.left : [],
          right: shuffleOptions && Array.isArray(pairs.right) ? shuffle(pairs.right, optRand()) : pairs.right ?? [],
        },
      };
    }
    if (q.type === 'BENAR_SALAH') {
      const statements = (Array.isArray(q.statements) ? q.statements : []) as Array<Record<string, unknown>>;
      return {
        ...base,
        statements: statements.map((s) => ({ id: s.id, text: s.text })),
      };
    }
    return base;
  }

  /** Bentuk state lengkap untuk klien: soal tersanitasi + jawaban tersimpan + timer. */
  private async buildState(attemptId: string) {
    const attempt = await this.prisma.attempt.findFirst({
      where: { id: attemptId, ...tenantWhere() },
      include: {
        session: {
          include: {
            exam: {
              select: {
                id: true,
                title: true,
                mapel: { select: { name: true } },
                questions: { orderBy: { order: 'asc' }, include: { question: true } },
              },
            },
          },
        },
        answers: true,
      },
    });
    if (!attempt) throw new NotFoundException('Attempt tidak ditemukan');
    const now = Date.now();
    const s = attempt.session;

    // Attempt terkunci (batas pelanggaran): kirim payload minimal — soal &
    // jawaban TIDAK dikirim sebelum proktor membuka lewat token.
    if (attempt.lockedAt) {
      return {
        locked: true,
        attempt: {
          id: attempt.id,
          status: attempt.status,
          startedAt: attempt.startedAt,
          expiresAt: attempt.expiresAt,
          submittedAt: attempt.submittedAt,
          violationCount: attempt.violationCount,
          sebVerified: attempt.sebVerified,
          score: null,
          lockedAt: attempt.lockedAt,
        },
        session: {
          id: s.id,
          title: s.title ?? s.exam.title,
          exam: { id: s.exam.id, title: s.exam.title },
          mapel: s.exam.mapel?.name ?? null,
          durationMin: s.durationMin,
          maxViolations: s.maxViolations,
          requireSeb: s.requireSeb,
          resultsPublished: s.resultsPublished,
        },
        questions: [],
        answers: [],
        serverTime: new Date(now).toISOString(),
        remainingSec: Math.max(0, Math.floor((attempt.expiresAt.getTime() - now) / 1000)),
      };
    }

    let questions = s.exam.questions.map((row) =>
      this.sanitizeQuestion(row as never, s.shuffleQuestions, s.shuffleOptions, attemptId),
    );
    if (s.shuffleQuestions) {
      questions = shuffle(questions, makeRng(hashSeed(`${attemptId}:order`)));
    }

    // Jawaban: DB adalah sumber utama; Redis sebagai cadangan bila DB kosong.
    let answers = attempt.answers.map((a) => ({
      questionId: a.questionId,
      payload: a.payload as unknown,
      isFlagged: a.isFlagged,
    }));
    if (answers.length === 0) {
      try {
        const hash = await this.redis.hgetall(answerHash(attemptId));
        answers = Object.entries(hash).map(([questionId, raw]) => {
          const parsed = JSON.parse(raw) as { p: unknown; f?: boolean };
          return { questionId, payload: parsed.p, isFlagged: Boolean(parsed.f) };
        });
      } catch {
        // Redis tidak wajib untuk melanjutkan ujian
      }
    }

    return {
      locked: false,
      attempt: {
        id: attempt.id,
        status: attempt.status,
        startedAt: attempt.startedAt,
        expiresAt: attempt.expiresAt,
        submittedAt: attempt.submittedAt,
        violationCount: attempt.violationCount,
        sebVerified: attempt.sebVerified,
        lockedAt: attempt.lockedAt ?? null,
        // Nilai TIDAK PERNAH dikirim ke siswa (keputusan sekolah, 11 Nov 2026) — guru membagikan lewat ekspor Excel.
        score: null,
      },
      session: {
        id: s.id,
        title: s.title ?? s.exam.title,
        exam: { id: s.exam.id, title: s.exam.title },
        mapel: s.exam.mapel?.name ?? null,
        durationMin: s.durationMin,
        maxViolations: s.maxViolations,
        requireSeb: s.requireSeb,
        shuffleQuestions: s.shuffleQuestions,
        shuffleOptions: s.shuffleOptions,
        resultsPublished: s.resultsPublished,
      },
      questions,
      answers,
      serverTime: new Date(now).toISOString(),
      remainingSec: Math.max(0, Math.floor((attempt.expiresAt.getTime() - now) / 1000)),
    };
  }

  /* ------------------------------- answer ---------------------------- */

  private validatePayload(question: { type: string; choices: unknown; statements: unknown; pairs: unknown }, payload: unknown) {
    const ids = (v: unknown): string[] =>
      Array.isArray(v) ? v.map((x) => (x as { id?: unknown })?.id).filter((x): x is string => typeof x === 'string') : [];
    switch (question.type) {
      case 'PG': {
        if (payload === null) return;
        if (typeof payload !== 'string' || !ids(question.choices).includes(payload)) {
          throw new BadRequestException('Jawaban PG tidak valid');
        }
        return;
      }
      case 'PG_KOMPLEKS': {
        if (!Array.isArray(payload) || payload.some((p) => typeof p !== 'string')) {
          throw new BadRequestException('Jawaban PG kompleks tidak valid');
        }
        const valid = ids(question.choices);
        if (payload.some((p) => !valid.includes(p as string))) {
          throw new BadRequestException('Ada opsi jawaban yang tidak dikenal');
        }
        return;
      }
      case 'BENAR_SALAH': {
        if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
          throw new BadRequestException('Jawaban benar-salah tidak valid');
        }
        const valid = ids(question.statements);
        for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
          if (!valid.includes(k) || typeof v !== 'boolean') {
            throw new BadRequestException('Jawaban benar-salah tidak valid');
          }
        }
        return;
      }
      case 'MATCHING': {
        if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
          throw new BadRequestException('Jawaban matching tidak valid');
        }
        const pairs = (question.pairs ?? {}) as { left?: unknown; right?: unknown };
        const left = ids(pairs.left);
        const right = ids(pairs.right);
        const rightSet = new Set(right);
        for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
          if (!left.includes(k) || typeof v !== 'string' || !rightSet.has(v)) {
            throw new BadRequestException('Jawaban matching tidak valid');
          }
        }
        return;
      }
      case 'ISIAN_SINGKAT': {
        if (typeof payload !== 'string') throw new BadRequestException('Jawaban isian tidak valid');
        return;
      }
      default:
        return;
    }
  }

  async saveAnswer(
    studentId: string,
    attemptId: string,
    dto: { questionId: string; payload?: unknown; isFlagged?: boolean },
    sebProof?: SebProof,
  ) {
    const attempt = await this.ownedAttempt(studentId, attemptId);
    this.assertNotLocked(attempt);
    this.assertSeb(attempt.session.requireSeb, sebProof);
    const synced = await this.syncExpiry(attempt);
    if (synced.status !== 'IN_PROGRESS') {
      throw new ConflictException('Ujian sudah selesai — jawaban tidak bisa disimpan');
    }
    // Payload boleh tidak dikirim (mis. klien hanya mengubah tanda "ragu-ragu"):
    // jangan timpa jawaban yang sudah tersimpan dengan null.
    const hasPayload = Object.prototype.hasOwnProperty.call(dto, 'payload') && dto.payload !== undefined;
    const payload = hasPayload ? dto.payload : null;
    const byId = await this.questionsForSession(attempt.sessionId);
    const question = byId.get(dto.questionId);
    if (!question) throw new BadRequestException('Soal tidak termasuk dalam ujian ini');
    if (hasPayload) this.validatePayload(question as never, payload);

    const saved = await this.prisma.attemptAnswer.upsert({
      where: { attemptId_questionId: { attemptId, questionId: dto.questionId } },
      update: {
        ...(hasPayload ? { payload: this.toJson(payload) } : {}),
        isFlagged: dto.isFlagged ?? undefined,
      },
      create: {
        attemptId,
        questionId: dto.questionId,
        payload: this.toJson(payload),
        isFlagged: dto.isFlagged ?? false,
        schoolId: attempt.schoolId,
      },
    });
    try {
      await this.redis.hset(
        answerHash(attemptId),
        dto.questionId,
        // Cermin Redis selalu mengikuti baris DB yang baru disimpan.
        JSON.stringify({ p: saved.payload as unknown, f: saved.isFlagged }),
      );
      await this.redis.expire(answerHash(attemptId), 60 * 60 * 24 * 3);
    } catch {
      // autosave Redis opsional; DB tetap sumber kebenaran
    }
    this.gateway.notifyActivity(attempt.sessionId, attemptId, 'answer');
    return { ok: true as const, questionId: dto.questionId, savedAt: new Date().toISOString() };
  }

  /* ------------------------------- submit ---------------------------- */

  async submit(studentId: string, attemptId: string, dto: AttemptSubmitInput, sebProof?: SebProof) {
    const attempt = await this.ownedAttempt(studentId, attemptId);
    this.assertNotLocked(attempt);
    this.assertSeb(attempt.session.requireSeb, sebProof);
    const synced = await this.syncExpiry(attempt);
    if (synced.status !== 'IN_PROGRESS') {
      return this.buildState(attemptId);
    }
    // Status attempt selalu ditentukan server — `reason` dari klien hanya
    // dicatat untuk audit (siswa tidak boleh menandai FORCE_SUBMITTED sendiri).
    const status = 'SUBMITTED' as const;
    const flipped = await this.prisma.attempt.updateMany({
      where: { id: attemptId, status: 'IN_PROGRESS' },
      data: { status, submittedAt: new Date() },
    });
    if (flipped.count === 0) {
      // Balapan dengan auto-expire/force-submit — status final sudah ditentukan pihak lain.
      return this.buildState(attemptId);
    }
    await this.audit.log({
      actorId: studentId,
      action: 'ATTEMPT_SUBMIT',
      entity: 'Attempt',
      entityId: attemptId,
      meta: { reason: dto.reason },
    });
    // Nilai otomatis langsung dihitung (Fase 7); hasilnya tetap tersembunyi
    // dari siswa sampai guru mem-publish sesi.
    await this.gradeQuietly(attemptId);
    this.gateway.notifyActivity(attempt.sessionId, attemptId, `submit:${dto.reason}`);
    return this.buildState(attemptId);
  }

  /* ----------------------------- integritas -------------------------- */

  async integrity(studentId: string, attemptId: string, dto: AttemptIntegrityInput, sebProof?: SebProof) {
    const attempt = await this.ownedAttempt(studentId, attemptId);
    this.assertNotLocked(attempt);
    this.assertSeb(attempt.session.requireSeb, sebProof);
    const synced = await this.syncExpiry(attempt);
    if (synced.status !== 'IN_PROGRESS') {
      return { violationCount: synced.violationCount ?? attempt.violationCount, forcedSubmitted: true as const, locked: false };
    }
    const session = await this.prisma.examSession.findFirst({
      where: { id: attempt.sessionId, ...tenantWhere() },
      select: { maxViolations: true },
    });
    await this.prisma.integrityLog.create({
      data: {
        attemptId,
        type: dto.type,
        detail: dto.detail ? (dto.detail as Prisma.InputJsonValue) : Prisma.JsonNull,
        schoolId: attempt.schoolId,
      },
    });
    const updated = await this.prisma.attempt.update({
      where: { id: attemptId },
      data: { violationCount: { increment: 1 } },
    });
    const max = session?.maxViolations ?? 0;
    const overLimit = max > 0 && updated.violationCount >= max;
    if (overLimit) {
      // Keputusan sekolah: BUKAN kumpul paksa. Attempt dikunci (jawaban tetap
      // tersimpan, siswa dikeluarkan); siswa minta token ke proktor untuk
      // membuka kembali — lihat POST /attempts/:id/unlock.
      const locked = await this.prisma.attempt.updateMany({
        where: { id: attemptId, status: 'IN_PROGRESS', lockedAt: null },
        data: { lockedAt: new Date() },
      });
      if (locked.count === 0) {
        // Balapan dengan submit/expire — status final ditentukan pihak lain.
        return { violationCount: updated.violationCount, maxViolations: max, forcedSubmitted: false, locked: false };
      }
      await this.audit.log({
        actorId: studentId,
        action: 'ATTEMPT_LOCKED',
        entity: 'Attempt',
        entityId: attemptId,
        schoolId: attempt.schoolId,
        meta: { reason: 'max_violations', count: updated.violationCount },
      });
      this.gateway.notifyActivity(attempt.sessionId, attemptId, 'locked');
      return { violationCount: updated.violationCount, maxViolations: max, forcedSubmitted: false, locked: true };
    }
    this.gateway.notifyActivity(attempt.sessionId, attemptId, 'integrity');
    return { violationCount: updated.violationCount, maxViolations: max, forcedSubmitted: false, locked: false };
  }

  /* ------------------------------- unlock ------------------------------ */

  /**
   * Buka attempt terkunci (batas pelanggaran) — HANYA dengan token sesi dari
   * proktor (TOTP yang sama dengan gerbang mulai). Rate-limit dipakai
   * bersama dengan gerbang mulai (per session+user, 10 salah / 5 menit → 429).
   */
  async unlock(studentId: string, attemptId: string, dto: AttemptUnlockInput, sebProof?: SebProof) {
    const attempt = await this.ownedAttempt(studentId, attemptId);
    this.assertSeb(attempt.session.requireSeb, sebProof);
    const synced = await this.syncExpiry(attempt);
    if (synced.status !== 'IN_PROGRESS') {
      throw new ConflictException('Attempt sudah selesai — tidak perlu dibuka');
    }
    if (!attempt.lockedAt) {
      throw new BadRequestException('Attempt tidak dalam status terkunci');
    }
    const session = await this.prisma.examSession.findFirst({
      where: { id: attempt.sessionId, ...tenantWhere() },
      select: { id: true, tokenSecret: true, tokenIntervalSec: true },
    });
    if (!session) throw new NotFoundException('Sesi tidak ditemukan');
    const tokenOk = await this.token.checkStartGate(session, dto.token, studentId);
    if (!tokenOk) {
      throw new BadRequestException('Token salah atau kedaluwarsa — minta token terbaru ke proktor');
    }
    // Keputusan sekolah: membuka kunci = reset hitungan pelanggaran ke 0.
    // (IntegrityLog tetap tersimpan untuk rekap; tidak menghapus histori.)
    await this.prisma.attempt.update({ where: { id: attemptId }, data: { lockedAt: null, violationCount: 0 } });
    await this.audit.log({
      actorId: studentId,
      action: 'ATTEMPT_UNLOCK',
      entity: 'Attempt',
      entityId: attemptId,
      schoolId: attempt.schoolId,
      meta: { via: 'token', violationCountReset: true },
    });
    this.gateway.notifyActivity(attempt.sessionId, attemptId, 'unlock');
    return this.buildState(attemptId);
  }
}
