import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as PDFKit from 'pdfkit';
import * as QRCode from 'qrcode';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import { AppConfigService } from '../common/config/app-config.service';
import { ruangByKelas } from './ruang-summary';
import { cardColumns } from './card-columns';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { tenantWhere } from '../common/tenant/tenant';
import { uploadsRoot } from '../common/uploads/upload-files';
import { decryptSecret } from '../common/crypto/secret-box';

/**
 * Kartu Login UNIVERSAL — satu kartu per siswa, berlaku untuk semua ujian.
 * Desain: A4 portrait, 8 kartu per halaman (2×4), logo sekolah + QR (WEB_URL),
 * blok tanda tangan kepala sekolah. Diteken kepala sekolah per sekolah
 * (School.headmasterName/Nip + gambar ttd & stempel yang diunggah admin).
 */
@Injectable()
export class KartuCetakService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AppConfigService) private readonly appConfig: AppConfigService,
  ) {}

  /** Jumlah kartu yang akan dicetak (pratinjau, per kelas). */
  async count(kelasId?: string) {
    const scope = tenantWhere();
    const where = { role: 'SISWA' as const, isActive: true, ...scope };
    const [total, byKelas, ruangGroups] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.kelas.findMany({
        where: scope,
        select: { id: true, name: true, _count: { select: { users: { where } } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.user.groupBy({
        by: ['kelasId', 'ruang'],
        where: { ...where, kelasId: { not: null } },
      }),
    ]);
    const ruangMap = ruangByKelas(ruangGroups.map((g) => ({ kelasId: g.kelasId, ruang: g.ruang })));
    const kelas = byKelas.map((k) => ({ id: k.id, name: k.name, ruang: ruangMap.get(k.id) ?? null, total: k._count.users }));
    const filtered = kelasId ? (kelas.find((k) => k.id === kelasId)?.total ?? 0) : total;
    return { total: filtered, kelas };
  }

  /**
   * PDF Kartu Login (A4 portrait, 8 per halaman).
   * `judul` = teks acara bebas (mis. "ASSESMEN SUMATIF AKHIR SEMESTER KELAS X").
   */
  async pdf(kelasId: string | undefined, judulInput: string | undefined, actorId: string): Promise<{ buffer: Buffer; filename: string }> {
    const scope = tenantWhere();
    const schoolId = scope.schoolId;
    if (!schoolId) {
      throw new BadRequestException('Pilih sekolah dulu lewat switcher sekolah di kanan atas untuk mencetak kartu.');
    }
    if (kelasId) {
      const k = await this.prisma.kelas.findFirst({ where: { id: kelasId, ...scope } });
      if (!k) throw new NotFoundException('Kelas tidak ditemukan di sekolah ini');
    }
    const [school, tahunAjaran] = await Promise.all([
      this.prisma.school.findUnique({ where: { id: schoolId } }),
      this.appConfig.getString('TAHUN_AJARAN', '2026/2027', schoolId),
    ]);
    if (!school) throw new NotFoundException('Sekolah tidak ditemukan');

    const judul = (judulInput ?? '').replace(/\s+/g, ' ').trim().slice(0, 120).toUpperCase();

    const students = await this.prisma.user.findMany({
      where: { role: 'SISWA', isActive: true, ...scope, ...(kelasId ? { kelasId } : {}) },
      select: {
        id: true, name: true, nisn: true, username: true, initialPassword: true, ruang: true,
        kelas: { select: { name: true } },
      },
      orderBy: [{ kelas: { name: 'asc' } }, { name: 'asc' }],
    });
    if (students.length === 0) {
      throw new BadRequestException('Tidak ada siswa aktif untuk dicetak');
    }

    const loginUrl = process.env.WEB_URL?.trim() || 'http://localhost:8080';
    const qrPng = await QRCode.toBuffer(loginUrl, { width: 220, margin: 0 });
    const logoAbs = school.logoPath ? join(uploadsRoot(), school.logoPath) : null;
    const ttdAbs = school.ttdPath ? join(uploadsRoot(), school.ttdPath) : null;
    const stampAbs = school.stampPath ? join(uploadsRoot(), school.stampPath) : null;
    const logoOk = logoAbs && existsSync(logoAbs);
    const ttdOk = ttdAbs && existsSync(ttdAbs);
    const stampOk = stampAbs && existsSync(stampAbs);

    const NAVY = '#103556';
    const LINE = '#212121';

    const chunks: Buffer[] = [];
    const doc = new (PDFKit.default as unknown as new (opts: Record<string, unknown>) => PDFKit.PDFDocument)({
      size: 'A4',
      margin: 0,
      bufferPages: true,
    });
    doc.on('data', (c: Buffer) => chunks.push(c));

    const W = 595.28;
    const H = 841.89;
    const cardW = 266;
    const cardH = 190;
    const gapX = 22;
    const gapY = 12;
    const marginX = (W - cardW * 2 - gapX) / 2;
        const marginTop = 22;
    const drawCard = (s: (typeof students)[number], x: number, y: number) => {
      // Bingkai kartu
      doc.roundedRect(x, y, cardW, cardH, 6).lineWidth(1.1).strokeColor(LINE).stroke();

      // Kepala: logo sekolah (bila ada, atau wordmark teks bila tidak) | judul | QR (WEB_URL)
      const hdrH = 52;
      if (logoOk && logoAbs) {
        doc.image(logoAbs, x + 8, y + 7, { width: 42, height: 42 });
      } else {
        // Wordmark: nama sekolah dipecah greedy ≤ 48pt, maks 3 baris, di kiri.
        const words = school.name.toUpperCase().split(' ');
        doc.font('Helvetica-Bold').fontSize(7.2);
        const lines: string[] = [];
        let line = '';
        for (const w of words) {
          const t = line ? `${line} ${w}` : w;
          if (line && doc.widthOfString(t) > 48) {
            lines.push(line);
            line = w;
          } else {
            line = t;
          }
        }
        if (line) lines.push(line);
        lines.slice(0, 3).forEach((ln, i) => {
          doc.font('Helvetica-Bold').fontSize(7.2).fillColor(NAVY)
            .text(ln, x + 4, y + 11 + i * 9.5, { width: 48, align: 'center', lineBreak: false });
        });
      }
      const textX = x + 56;
      const textW = cardW - 116;
      doc.fillColor('#212121').font('Helvetica-Bold').fontSize(7.6)
        .text('KARTU LOGIN PESERTA', textX, y + 5, { width: textW, align: 'center', characterSpacing: 0.4 });
      let hy = y + 15;
      if (judul) {
        doc.font('Helvetica-Bold').fontSize(7.4)
          .text(judul, textX, hy, { width: textW, align: 'center' });
        hy = doc.y + 1;
      }
      doc.font('Helvetica-Bold').fontSize(7.4)
        .text(`TAHUN PELAJARAN ${tahunAjaran}`, textX, hy, { width: textW, align: 'center' });
      doc.image(qrPng, x + cardW - 8 - 44, y + 7, { width: 44, height: 44 });
      doc.moveTo(x, y + hdrH).lineTo(x + cardW, y + hdrH).lineWidth(0.8).strokeColor(LINE).stroke();

      // Isi: identitas peserta
      let cy = y + hdrH + 7;
      const { labelX, labelW, colonX, valueX, valueW } = cardColumns(x, cardW);
      // Teks panjang tidak pernah melebihi lebar kolom: perkecil font, lalu potong
      // dengan ellipsis — deterministik satu baris (mencegah nama menutupi baris bawah).
      const fitText = (text: string, font: string, size: number, minSize: number, maxW: number) => {
        doc.font(font).fontSize(size);
        if (doc.widthOfString(text) <= maxW) return { text, size };
        let s = size;
        while (s - 0.8 >= minSize) {
          s -= 0.8;
          doc.font(font).fontSize(s);
          if (doc.widthOfString(text) <= maxW) return { text, size: s };
        }
        doc.font(font).fontSize(minSize);
        let t = text;
        while (t.length > 1 && doc.widthOfString(t.trimEnd() + '…') > maxW) t = t.slice(0, -1);
        return { text: t.trimEnd() + '…', size: minSize };
      };
      const row = (label: string, value: () => void, step = 13.8) => {
        doc.font('Helvetica').fontSize(7.2).fillColor('#212121')
          .text(label, labelX, cy, { width: labelW, lineBreak: false });
        // Titik dua digambar terpisah di x tetap agar sejajar di semua baris.
        doc.text(':', colonX, cy, { width: 6, lineBreak: false });
        value();
        cy += step;
      };
      row('Nama Peserta', () => {
        const full = s.name || '-';
        const fit = fitText(full, 'Helvetica-Bold', 8.2, 6.2, valueW);
        doc.font('Helvetica-Bold').fontSize(fit.size).fillColor('#212121')
          .text(fit.text, valueX, cy - 1, { width: valueW, lineBreak: false });
      }, 13.5);
      row('Kelas', () => {
        doc.font('Helvetica').fontSize(8.2).fillColor('#212121')
          .text(s.kelas?.name ?? '-', valueX, cy - 1, { width: valueW, lineBreak: false });
      }, 13.5);
      row('Username Login', () => {
        doc.font('Courier-Bold').fontSize(10).fillColor('#212121')
          .text(s.username, valueX, cy - 2.5, { width: valueW, lineBreak: false });
      }, 15);
      row('Password Login', () => {
        doc.font('Courier-Bold').fontSize(10).fillColor('#212121')
          .text(s.initialPassword ? decryptSecret(s.initialPassword) : '-', valueX, cy - 2.5, { width: valueW, lineBreak: false });
      }, 15);
      row('Ruang Ujian', () => {
        doc.font('Helvetica-Bold').fontSize(8.2).fillColor('#212121')
          .text(s.ruang ?? '........................', valueX, cy - 1, { width: valueW, lineBreak: false });
      }, 8);

      // Bawah: catatan (kiri) + kepala sekolah (kanan).
      // Susunan vertikal tanpa tumpang tindih: label → gambar ttd/stempel → nama → NIP.
      const bottomY = y + cardH - 64;
      doc.rect(x + 9, bottomY, 118, 30).lineWidth(0.8).strokeColor(LINE).stroke();
      doc.font('Helvetica-Bold').fontSize(5.6).fillColor('#212121').text('Catatan:', x + 12, bottomY + 3);
      doc.font('Helvetica').fontSize(5.6).fillColor('#212121')
        .text('Kartu peserta wajib dibawa selama ujian berlangsung.', x + 12, bottomY + 11, { width: 112, lineGap: 0.5 });

      const sigX = x + 133;
      const sigW = cardW - 133 - 9;
      // Label di ATAS gambar — tidak tertutup stempel/ttd.
      doc.font('Helvetica').fontSize(6.6).fillColor('#212121')
        .text('Kepala Sekolah', sigX, bottomY, { width: sigW, align: 'center', lineBreak: false });
      // Gambar ttd/stempel di zona khusus di bawah label.
      // ttd (transparan) digambar DI ATAS stempel agar coretan terlihat.
      if (stampOk && stampAbs) {
        doc.image(stampAbs, sigX + sigW / 2 - 27.5, bottomY + 9, { height: 36 });
      }
      if (ttdOk && ttdAbs) {
        doc.image(ttdAbs, sigX + sigW / 2 - 36, bottomY + 11.5, { height: 19 });
      }
      const nameY = bottomY + 47.5;
      doc.font('Helvetica-Bold').fontSize(6.6).fillColor('#212121')
        .text((school.headmasterName ?? '(nama belum diatur)').toUpperCase(), sigX, nameY, { width: sigW, align: 'center', lineBreak: false });
      if (school.headmasterNip) {
        doc.font('Helvetica').fontSize(6.2).fillColor('#212121')
          .text(`NIP. ${school.headmasterNip}`, sigX, nameY + 8, { width: sigW, align: 'center', lineBreak: false });
      }
    };

    const perPage = 8;
    const totalPages = Math.ceil(students.length / perPage);
    for (let page = 0; page < totalPages; page++) {
      if (page > 0) doc.addPage({ size: 'A4', margin: 0 });
      const chunk = students.slice(page * perPage, page * perPage + perPage);
      chunk.forEach((s, i) => {
        const col = i % 2;
        const rowIdx = Math.floor(i / 2);
        drawCard(s, marginX + col * (cardW + gapX), marginTop + rowIdx * (cardH + gapY));
      });
    }

    doc.end();
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    await this.audit.log({
      actorId,
      action: 'KARTU_PRINT',
      entity: 'User',
      schoolId,
      meta: { total: students.length, pages: totalPages, kelasId: kelasId ?? 'SEMUA', judul: judul || null },
    });
    const safe = (v: string) => v.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
    return {
      buffer,
      filename: kelasId ? `kartu-login-${safe(students[0]?.kelas?.name ?? 'kelas')}.pdf` : 'kartu-login-semua.pdf',
    };
  }
}
