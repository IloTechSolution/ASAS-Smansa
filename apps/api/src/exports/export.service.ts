import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as PDFKit from 'pdfkit';
import { writeWorkbook } from '../common/excel/excel.helper';
import { AttendanceService } from '../attendance/attendance.service';
import { GradingService } from '../grading/grading.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { assertExamManager } from '../common/session-access/session-access';
import { tenantWhere } from '../common/tenant/tenant';

/** Export data proktor — berkas Excel (.xlsx) / PDF. */
@Injectable()
export class ExportService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AttendanceService) private readonly attendance: AttendanceService,
    @Inject(GradingService) private readonly grading: GradingService,
  ) {}

  async attendanceXlsx(sessionId: string, actorId?: string, actorRole?: string): Promise<Buffer> {
    if (actorId) await assertExamManager(this.prisma, sessionId, actorId, actorRole ?? 'PROKTOR');
    const { summary, data } = await this.attendance.list(sessionId);
    const header = ['No', 'Nama', 'NISN', 'Username', 'Kelas', 'Absensi', 'Catatan', 'Ditandai Oleh', 'Waktu'];
    const rows = data.map((d, i) => {
      const a = d.attendance ?? null;
      return [
        i + 1,
        d.user.name,
        d.user.nisn ?? '-',
        d.user.username,
        d.user.kelas?.name ?? '-',
        a?.status ?? 'Belum hadir',
        a?.note ?? '-',
        a?.checkedInBy?.name ?? '-',
        a?.checkedInAt ? new Date(a.checkedInAt).toLocaleString('id-ID') : '-',
      ];
    });
    const ringkasan: unknown[][] = [['Status', 'Jumlah'], ['Total', summary.total], ['Tercatat', summary.recorded]];
    for (const [k, v] of Object.entries(summary)) {
      if (k !== 'total' && k !== 'recorded') ringkasan.push([k, v as number]);
    }
    return writeWorkbook([
      { name: 'Absensi', header, rows },
      { name: 'Ringkasan', rows: ringkasan },
    ]);
  }

  async ringkasanXlsx(sessionId: string, actorId?: string, actorRole?: string): Promise<Buffer> {
    if (actorId) await assertExamManager(this.prisma, sessionId, actorId, actorRole ?? 'PROKTOR');
    const { summary, data } = await this.attendance.list(sessionId);
    const header = ['No', 'Nama', 'NISN', 'Username', 'Kelas', 'Absensi', 'Ditandai Oleh', 'Waktu'];
    const rows = data.map((d, i) => {
      const a = d.attendance ?? null;
      return [
        i + 1,
        d.user.name,
        d.user.nisn ?? '-',
        d.user.username,
        d.user.kelas?.name ?? '-',
        a?.status ?? 'Belum hadir',
        a?.checkedInBy?.name ?? '-',
        a?.checkedInAt ? new Date(a.checkedInAt).toLocaleString('id-ID') : '-',
      ];
    });
    return writeWorkbook([
      { name: 'Ringkasan', header, rows },
      { name: 'Statistik', rows: [['Total peserta', summary.total], ['Tercatat', summary.recorded]] },
    ]);
  }

  /**
   * Rekap nilai satu sesi → Excel, termasuk KKM mapel & ketuntasan.
   * Guru hanya boleh mengunduh nilai ujiannya sendiri (atau admin).
   */
  async nilaiXlsx(sessionId: string, actorId: string, actorRole: string): Promise<Buffer> {
    const sesi = await this.prisma.examSession.findFirst({
      where: { id: sessionId, ...tenantWhere() },
      include: {
        exam: {
          include: {
            mapel: { select: { name: true, kkm: true } },
            createdBy: { select: { role: true } },
            questions: { select: { question: { select: { weight: true } } } },
          },
        },
      },
    });
    if (!sesi) throw new NotFoundException('Sesi tidak ditemukan');
    const isAdminExam = sesi.exam.createdBy?.role === 'ADMIN';
    if (actorRole !== 'ADMIN' && sesi.exam.createdById !== actorId && !(actorRole === 'GURU' && isAdminExam)) {
      throw new ForbiddenException('Anda bukan pemilik ujian/sesi ini');
    }
    // Guru harus menilai dulu semua isian singkat (review) sebelum nilai bisa diekspor.
    const pending = await this.grading.countPendingReview(sessionId);
    if (pending > 0) {
      throw new ConflictException(`Masih ada ${pending} jawaban isian singkat yang belum dinilai — selesaikan review dulu sebelum export nilai`);
    }

    const kkm = sesi.exam.mapel?.kkm ?? 75;
    const maxScore = sesi.exam.questions.reduce((sum, l) => sum + (Number(l.question.weight) || 0), 0);
    const pctOf = (v: number) => (maxScore > 0 ? (v / maxScore) * 100 : 0);

    const attempts = await this.prisma.attempt.findMany({
      where: { sessionId, ...tenantWhere() },
      include: { user: { select: { name: true, nisn: true, username: true, kelas: { select: { name: true } } } } },
      orderBy: { startedAt: 'asc' },
    });

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const header = ['No', 'Nama', 'NISN', 'Username', 'Kelas', 'Status', 'Skor', 'Maks', 'Persen', 'KKM', 'Keterangan'];
    const rows = attempts.map((a, i) => {
      const finished = a.status !== 'IN_PROGRESS';
      const scored = finished && a.score !== null;
      const percent = scored ? round2(pctOf(a.score as number)) : null;
      const lulus = percent !== null && percent >= kkm;
      return [
        i + 1,
        a.user.name,
        a.user.nisn ?? '-',
        a.user.username,
        a.user.kelas?.name ?? '-',
        finished ? a.status : 'BELUM SELESAI',
        scored ? round2(a.score as number) : '-',
        round2(maxScore),
        percent !== null ? percent : '-',
        kkm,
        !scored ? '-' : lulus ? 'LULUS' : 'TIDAK LULUS',
      ];
    });
    const graded = attempts.filter((a) => a.status !== 'IN_PROGRESS' && a.score !== null);
    const passed = graded.filter((a) => pctOf(a.score as number) >= kkm).length;
    return writeWorkbook([
      { name: 'Nilai', header, rows },
      {
        name: 'Ringkasan',
        rows: [
          ['Sesi', sesi.title ?? sesi.exam.title],
          ['Mata Pelajaran', sesi.exam.mapel?.name ?? '-'],
          ['KKM', kkm],
          ['Peserta', attempts.length],
          ['Selesai dinilai', graded.length],
          ['LULUS', passed],
          ['TIDAK LULUS', graded.length - passed],
        ],
      },
    ]);
  }

  /**
   * Daftar hadir ujian → PDF untuk diunduh/cetak (absensi manual + tanda tangan).
   * GURU hanya ujiannya (+ ujian ADMIN); admin & proktor bebas.
   */
  async absensiPdf(sessionId: string, actorId: string, actorRole: string): Promise<{ buffer: Buffer; filename: string }> {
    const sesi = await this.prisma.examSession.findFirst({
      where: { id: sessionId, ...tenantWhere() },
      include: {
        exam: { include: { mapel: { select: { name: true } }, createdBy: { select: { role: true } } } },
        kelasLinks: { include: { kelas: { select: { name: true } } } },
      },
    });
    if (!sesi) throw new NotFoundException('Sesi tidak ditemukan');
    const isAdminExam = sesi.exam.createdBy?.role === 'ADMIN';
    if (actorRole === 'GURU' && sesi.exam.createdById !== actorId && !isAdminExam) {
      throw new ForbiddenException('Anda bukan pemilik ujian/sesi ini');
    }

    const schoolRow = await this.prisma.school.findUnique({ where: { id: sesi.schoolId } });
    const school = schoolRow?.name ?? 'SMAN 1 Gorontalo';
    const appName = schoolRow?.appName ?? 'CBT';
    const peserta = await this.attendance.participants(sessionId);
    const kelasNames = sesi.kelasLinks.map((k) => k.kelas.name).join(', ') || '—';
    const printedAt = new Date().toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' });

    const NAVY = '#103556';
    const GOLD = '#FFC53D';
    const GREY = '#616161';

    const chunks: Buffer[] = [];
    const doc = new (PDFKit.default as unknown as new (opts: Record<string, unknown>) => PDFKit.PDFDocument)({
      size: 'A4',
      margin: 0,
      bufferPages: true,
    });
    doc.on('data', (c: Buffer) => chunks.push(c));

    const pageW = 595.28;
    const M = 36;
    const contentW = pageW - M * 2;

    let y = 0;
    const drawHeader = (first: boolean) => {
      doc.rect(0, 0, pageW, 56).fill(NAVY);
      doc.rect(0, 56, pageW, 4).fill(GOLD);
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10).text(school.toUpperCase(), M, 12, { width: contentW, align: 'center' });
      doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(13).text('DAFTAR HADIR UJIAN', M, 28, { width: contentW, align: 'center' });
      y = 76;
      if (first) {
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text(sesi.title ?? sesi.exam.title, M, y);
        y += 16;
        doc.fillColor('#212121').font('Helvetica').fontSize(9)
          .text(`Mata Pelajaran: ${sesi.exam.mapel?.name ?? '—'}    Kelas: ${kelasNames}    Dicetak: ${printedAt}`, M, y, { width: contentW });
        y += 18;
        doc.moveTo(M, y).lineTo(pageW - M, y).lineWidth(1).strokeColor(GOLD).stroke();
        y += 10;
      }
    };

    const colNo = 34;
    const colNisn = 74;
    const colKelas = 84;
    const colSign = 120;
    const colNama = contentW - colNo - colNisn - colKelas - colSign;
    const rowH = 24;

    const drawTableHeader = () => {
      doc.rect(M, y, contentW, 20).fill('#E8EEF5');
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8);
      let x = M + 4;
      doc.text('No', x, y + 6, { width: colNo - 8 });
      x += colNo; doc.text('Nama', x, y + 6, { width: colNama - 8 });
      x += colNama; doc.text('NISN', x, y + 6, { width: colNisn - 8 });
      x += colNisn; doc.text('Kelas', x, y + 6, { width: colKelas - 8 });
      x += colKelas; doc.text('Tanda Tangan', x, y + 6, { width: colSign - 8, align: 'center' });
      y += 20;
    };

    drawHeader(true);
    drawTableHeader();

    peserta.forEach((u, i) => {
      if (y + rowH > 800) {
        doc.addPage();
        y = 36;
        drawTableHeader();
      }
      if (i % 2 === 1) {
        doc.rect(M, y, contentW, rowH).fill('#F7FAFD');
      }
      doc.fillColor('#212121').font('Helvetica').fontSize(8.5);
      let x = M + 4;
      doc.text(String(i + 1), x, y + 8, { width: colNo - 8 });
      x += colNo; doc.text(u.name, x, y + 8, { width: colNama - 8, ellipsis: true });
      x += colNama; doc.text(u.nisn ?? '—', x, y + 8, { width: colNisn - 8 });
      x += colNisn; doc.text(u.kelas?.name ?? '—', x, y + 8, { width: colKelas - 8 });
      // sel tanda tangan kosong — siswa menandatangani manual
      x += colKelas; doc.rect(x + 2, y + 2, colSign - 6, rowH - 4).lineWidth(0.5).strokeColor('#B0BEC9').stroke();
      y += rowH;
    });

    if (peserta.length === 0) {
      doc.fillColor(GREY).font('Helvetica-Oblique').fontSize(10).text('Belum ada peserta di sesi ini.', M, y + 10);
    }

    y += 18;
    if (y > 780) { doc.addPage(); y = 36; }
    doc.fillColor(GREY).font('Helvetica-Oblique').fontSize(8)
      .text('Peserta menandatangani kolom tanda tangan saat memasuki ruangan ujian. Berkas ini sah sebagai daftar hadir manual.', M, y, { width: contentW });

    // Footer + nomor halaman
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.rect(0, 810, pageW, 32).fill(NAVY);
      doc.fillColor('#FFFFFF').font('Helvetica').fontSize(7)
        .text(`${appName} · ${new Date().getFullYear()}`, M, 822, { width: contentW * 0.6 });
      doc.fillColor('#CBD5E1').fontSize(7)
        .text(`Halaman ${i + 1} dari ${range.count}`, M, 822, { width: contentW, align: 'right' });
    }

    doc.end();
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    const safe = (v: string) => (v || 'sesi').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
    return { buffer, filename: `daftar-hadir-${safe(sesi.title ?? sesi.exam.title)}.pdf` };
  }

}
