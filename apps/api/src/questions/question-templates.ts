import * as ExcelJS from 'exceljs';
import {
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

/**
 * Pembuat template import soal (Excel + DOCX) — untuk guru.
 * Excel: diformat rapi dengan sheet Petunjuk lengkap.
 * DOCX: satu tabel "Label | Isian" per soal, mudah diisi di Word.
 */

const EXAMPLE_ROWS: Array<[string, string, string, string, string, string, string, string, string, string, string]> = [
  ['PG', 'Ibu kota Indonesia adalah…?', '1', 'ALL_OR_NOTHING', 'Ibukota saat ini Nusantara/Jakarta (tergantung konteks kurikulum).', 'A|Jakarta;B|Bandung;C|Surabaya;D|Medan', 'A', '', '', '', ''],
  ['PG_KOMPLEKS', 'Pilih bilangan genap.', '1', 'PROPORSIONAL', '', 'A|2;B|3;C|4;D|5', 'A,C', '', '', '', ''],
  ['MATCHING', 'Jodohkan provinsi dan ibu kota.', '1', 'ALL_OR_NOTHING', '', '', '', '', 'Jawa Barat;Jawa Timur;Jawa Tengah', 'Bandung;Surabaya;Semarang', ''],
  ['BENAR_SALAH', 'Beri nilai pernyataan berikut.', '1', 'ALL_OR_NOTHING', '', '', '', '', '', '', 'Bumi berbentuk bulat|B;Matahari mengelilingi bumi|S'],
  ['ISIAN_SINGKAT', 'Ibu kota Indonesia adalah …', '1', 'ALL_OR_NOTHING', '', '', '', 'Jakarta,Nusantara', '', '', ''],
];

const HEADERS = ['Tipe', 'Konten', 'Bobot', 'Mode Skor', 'Pembahasan', 'Opsi', 'Kunci', 'KunciIsian', 'Kiri', 'Kanan', 'Pernyataan'];

const COL_W = [16, 48, 10, 18, 36, 36, 14, 22, 28, 28, 46];

const NAVY = 'FF103556';
const GOLD = 'FFFFC53D';
const SOFT = 'FFF2F6FB';

export async function buildExcelTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CBT SMAN 1 Gorontalo';
  wb.created = new Date();

  // ---------- Sheet 'Soal' ----------
  const ws = wb.addWorksheet('Soal', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = HEADERS.map((h, i) => ({ header: h, key: h, width: COL_W[i] }));
  ws.autoFilter = { from: 'A1', to: 'K1' };

  const header = ws.getRow(1);
  header.values = HEADERS;
  header.height = 24;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Calibri' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thinBorder();
  });

  EXAMPLE_ROWS.forEach((r, idx) => {
    const row = ws.addRow(r);
    row.height = 34;
    row.eachCell((cell) => {
      cell.border = thinBorder();
      cell.alignment = { vertical: 'middle', wrapText: true };
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };
      }
    });
    row.getCell(1).font = { bold: true, color: { argb: NAVY } };
  });

  // ---------- Sheet 'Petunjuk' ----------
  const p = wb.addWorksheet('Petunjuk');
  p.columns = [{ width: 22 }, { width: 14 }, { width: 60 }, { width: 46 }];
  const title = p.addRow(['PETUNJUK IMPORT SOAL', '', '', '']);
  title.font = { bold: true, size: 16, color: { argb: NAVY } };
  title.height = 28;
  const sub = p.addRow(['CBT SMAN 1 Gorontalo — bank soal sekolah', '', '', '']);
  sub.font = { italic: true, size: 9, color: { argb: 'FF64748B' } };
  p.addRow([]);

  const h2 = (t: string) => {
    const r = p.addRow([t, '', '', '']);
    r.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    r.height = 20;
    for (let i = 1; i <= 4; i += 1) {
      r.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      r.getCell(i).alignment = { vertical: 'middle' };
    }
  };
  const bullet = (t: string) => {
    const r = p.addRow([`•  ${t}`, '', '', '']);
    p.mergeCells(`A${r.number}:D${r.number}`);
    r.getCell(1).alignment = { wrapText: true, vertical: 'middle' };
    r.height = 30;
  };
  const colRow = (name: string, req: string, isi: string, contoh: string) => {
    const r = p.addRow([name, req, isi, contoh]);
    r.eachCell((c) => {
      c.border = thinBorder();
      c.alignment = { wrapText: true, vertical: 'middle' };
    });
    r.getCell(1).font = { bold: true, color: { argb: NAVY } };
    r.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
    r.height = 34;
  };

  h2('CARA PAKAI');
  bullet('Satu baris di sheet "Soal" = satu soal. JANGAN mengubah nama kolom pada baris pertama.');
  bullet('Isi kolom sesuai tipe soal (lihat bagian TIPE SOAL di bawah). Kolom yang tidak dipakai dikosongkan.');
  bullet('Unggah berkas di menu Bank Soal → Impor Excel. Baris yang salah dilaporkan per baris; sisanya tetap masuk.');
  bullet('Maksimal 500 soal per impor. Gambar soal/pilihan diunggah manual setelah soal tersimpan.');
  bullet('Jangan pakai awalan =, +, -, @ pada teks soal (Sheet Excel memperlakukannya sebagai rumus; otomatis di-escape).');

  p.addRow([]);
  h2('KOLOM');
  colRow('Tipe', 'WAJIB', 'PG / PG_KOMPLEKS / MATCHING / BENAR_SALAH / ISIAN_SINGKAT', 'PG');
  colRow('Konten', 'WAJIB', 'Teks pertanyaan', 'Ibu kota Indonesia adalah…?');
  colRow('Bobot', 'opsional', 'Nilai butir soal. 0,5–100. Kosong = 1', '1');
  colRow('Mode Skor', 'opsional', 'ALL_OR_NOTHING (seluruhnya benar baru dapat skor) / PROPORSIONAL (butir benar mendapat skor proporsional). Kosong = ALL_OR_NOTHING', 'PROPORSIONAL');
  colRow('Pembahasan', 'opsional', 'Teks pembahasan; kosongkan bila tidak ada', 'Ibu kota saat ini Nusantara');
  colRow('Opsi', 'PG*', 'Pilihan jawaban. Format: ID|teks;ID|teks;… Pisahkan soal dengan titik koma. Minimal 2 opsi', 'A|Jakarta;B|Bandung;C|Surabaya');
  colRow('Kunci', 'PG*', 'ID opsi yang benar. Untuk PG_KOMPLEKS boleh lebih dari satu, pisah koma', 'A');
  colRow('KunciIsian', 'ISIAN*', 'Jawaban yang diterima, pisah koma. Cocok tidak peka huruf besar-kecil dan spasi', 'Jakarta,Nusantara');
  colRow('Kiri', 'MATCHING*', 'Kolom kiri, pisah titik koma. Urutan harus berpasangan dengan kolom Kanan', 'Jawa Barat;Jawa Timur;Jawa Tengah');
  colRow('Kanan', 'MATCHING*', 'Kolom kanan, urutan berpasangan dengan Kiri (digunakan untuk mapping otomatis sesuai urutan)', 'Bandung;Surabaya;Semarang');
  colRow('Pernyataan', 'BENAR_SALAH*', 'Pernyataan dan jawabannya, format: teks|B atau teks|S;…', 'Bumi bulat|B;Matahari mengelilingi bumi|S');
  const legend = p.addRow(['(* wajib untuk tipe soal tersebut)', '', '', '']);
  legend.font = { italic: true, size: 8, color: { argb: 'FF64748B' } };

  p.addRow([]);
  h2('TIPE SOAL');
  colRow('PG', '', 'Pilihan ganda satu jawaban benar. Kolom yang dipakai: Opsi, Kunci', 'Kunci: A');
  colRow('PG_KOMPLEKS', '', 'Pilihan ganda multi jawaban. Kolom: Opsi, Kunci (mis. A,C), Mode Skor sebaiknya PROPORSIONAL', 'Kunci: A,C');
  colRow('MATCHING', '', 'Menjodohkan. Kolom: Kiri, Kanan. Urutan baris kiri ke-1 cocok dengan kanan ke-1, dst.', 'Kiri: A;B | Kanan: 1;2');
  colRow('BENAR_SALAH', '', 'Pernyataan benar/salah. Kolom: Pernyataan. B = Benar, S = Salah', 'Bumi bulat|B');
  colRow('ISIAN_SINGKAT', '', 'Jawaban singkat. Kolom: KunciIsian (multi jawaban dipisah koma)', 'Jakarta,Nusantara');

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

function thinBorder(): ExcelJS.Borders {
  const thin: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFD5DDE8' } };
  return { top: thin, left: thin, bottom: thin, right: thin } as ExcelJS.Borders;
}

/* --------------------------- DOCX template ---------------------------- */

interface DocxExample {
  type: string;
  content: string;
  weight: string;
  mode?: string;
  explanation?: string;
  rows: Array<[string, string]>;
}

const DOCX_EXAMPLES: DocxExample[] = [
  {
    type: 'PG',
    content: 'Ibu kota Indonesia adalah …?',
    weight: '1',
    explanation: 'Ibu kota saat ini adalah Nusantara; Jakarta adalah ibu kota lama.',
    rows: [
      ['Jawaban A', 'Jakarta'],
      ['Jawaban B', 'Bandung'],
      ['Jawaban C', 'Surabaya'],
      ['Jawaban D', 'Medan'],
      ['Kunci', 'A'],
    ],
  },
  {
    type: 'PG_KOMPLEKS',
    content: 'Pilih bilangan genap.',
    weight: '1',
    mode: 'PROPORSIONAL',
    rows: [
      ['Jawaban A', '2'],
      ['Jawaban B', '3'],
      ['Jawaban C', '4'],
      ['Jawaban D', '5'],
      ['Kunci', 'A,C'],
    ],
  },
  {
    type: 'MATCHING',
    content: 'Jodohkan provinsi dan ibu kotanya.',
    weight: '1',
    rows: [
      ['Kiri', 'Jawa Barat;Jawa Timur;Jawa Tengah'],
      ['Kanan', 'Bandung;Surabaya;Semarang'],
    ],
  },
  {
    type: 'BENAR_SALAH',
    content: 'Beri nilai pernyataan berikut.',
    weight: '1',
    rows: [['Pernyataan', 'Bumi berbentuk bulat|B;Matahari mengelilingi bumi|S']],
  },
  {
    type: 'ISIAN_SINGKAT',
    content: 'Ibu kota Indonesia adalah …',
    weight: '1',
    rows: [['KunciIsian', 'Jakarta,Nusantara']],
  },
];

const docxBorder = {
  top: { style: BorderStyle.SINGLE, size: 4, color: 'D5DDE8' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D5DDE8' },
  left: { style: BorderStyle.SINGLE, size: 4, color: 'D5DDE8' },
  right: { style: BorderStyle.SINGLE, size: 4, color: 'D5DDE8' },
};

function docxCell(text: string, opts: { width: number; bold?: boolean; fill?: string; color?: string }): TableCell {
  return new TableCell({
    width: { size: opts.width, type: WidthType.PERCENTAGE },
    borders: docxBorder,
    shading: opts.fill ? { fill: opts.fill } : undefined,
    margins: { top: 90, bottom: 90, left: 140, right: 140 },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: opts.bold ?? false, size: 18, color: opts.color ?? '212121' })],
      }),
    ],
  });
}

export async function buildDocxTemplate(): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [];

  children.push(new Paragraph({ heading: HeadingLevel.TITLE, text: 'TEMPLATE IMPORT SOAL — CBT' }));
  children.push(
    new Paragraph({
      children: [new TextRun({ text: 'CBT SMAN 1 Gorontalo · Bank Soal · satu tabel = satu soal', size: 18, color: '64748B' })],
      spacing: { after: 200 },
    }),
  );
  children.push(
    new Paragraph({
      children: [new TextRun({ text: 'Cara mengisi', bold: true, size: 22, color: '103556' })],
      spacing: { before: 120, after: 80 },
    }),
  );
  const howto = [
    'Setiap tabel = satu soal. Isi kolom kanan; kolom kiri adalah label yang sudah disiapkan.',
    'Teks soal wajib diisi. Bobot boleh kosong (default 1) atau diisi 0,5–100.',
    'Untuk PG, isi Jawaban A–D lalu tulis ID kunci (A, atau A,C untuk PG_KOMPLEKS).',
    'Baris yang tidak dipakai untuk tipe tersebut boleh dikosongkan.',
    'Ganti kelima contoh di bawah dengan soal Anda, atau salin tabel untuk soal tambahan. Maksimal 500 soal.',
    'Gambar soal/opsi tidak bisa diunggah lewat DOCX; tambahkan di Bank Soal setelah soal tersimpan.',
  ];
  for (const t of howto) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `•  ${t}`, size: 19 })],
        indent: { left: 360 },
        spacing: { after: 60 },
      }),
    );
  }

  DOCX_EXAMPLES.forEach((ex, i) => {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `Contoh ${i + 1} — ${ex.type}`, bold: true, size: 18, color: '64748B' })],
        spacing: { before: 180, after: 60 },
      }),
    );
    const common: Array<[string, string]> = [
      ['Tipe', ex.type],
      ['Teks soal', ex.content],
      ['Bobot', ex.weight],
      ['Mode Skor', ex.mode ?? 'ALL_OR_NOTHING'],
      ['Pembahasan', ex.explanation ?? ''],
    ];
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [
              new TableCell({
                columnSpan: 2,
                shading: { fill: '103556' },
                borders: docxBorder,
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: `SOAL ${i + 1} · ${ex.type}`, bold: true, color: 'FFFFFF', size: 20 })],
                  }),
                ],
              }),
            ],
          }),
          ...[...common, ...ex.rows].map(
            ([label, value]) =>
              new TableRow({
                children: [
                  docxCell(label, { width: 32, bold: true, fill: 'F2F6FB', color: '103556' }),
                  docxCell(value, { width: 68 }),
                ],
              }),
          ),
        ],
      }),
    );
    children.push(new Paragraph({ spacing: { after: 120 } }));
  });

  const doc = new Document({ creator: 'CBT SMAN 1 Gorontalo', sections: [{ children }] });
  return Packer.toBuffer(doc);
}
